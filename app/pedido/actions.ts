"use server";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clienteServico } from "@/lib/supabase/servico";
import { TOKEN_VALIDO } from "@/lib/publico";
import { EXTENSAO, TAMANHO_MAXIMO, TIPOS_ACEITOS, validarComprovante, type TipoAceito } from "@/lib/arquivo";
import { telefoneValido } from "@/lib/telefone";

export interface EstadoPedido { erro?: string }

async function origemAnonima() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "desconhecido";
  return createHash("sha256").update(`${process.env.HASH_SALT ?? process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "liscia"}:${ip}`).digest("hex").slice(0, 32);
}

/** O navegador manda só produto e quantidade. Preços e totais são calculados no banco. */
export async function enviarPedido(_: EstadoPedido, d: FormData): Promise<EstadoPedido> {
  let itens: { produto_id: string; quantidade: number }[];
  try {
    const bruto = JSON.parse(String(d.get("itens") ?? "[]"));
    if (!Array.isArray(bruto) || bruto.length > 20) throw new Error();
    itens = bruto
      .map((i) => ({ produto_id: String(i.produto_id), quantidade: Math.floor(Number(i.quantidade)) }))
      .filter((i) => Number.isFinite(i.quantidade) && i.quantidade > 0);
  } catch {
    return { erro: "Não foi possível ler os itens. Recarregue a página." };
  }
  const nome = String(d.get("nome") ?? "").trim();
  const telefone = String(d.get("telefone") ?? "");
  const tipo = String(d.get("tipo") ?? "");
  const condominio = tipo === "condominio" ? String(d.get("condominio_id") ?? "") : "";
  if (tipo === "condominio" && !/^[0-9a-f-]{36}$/.test(condominio)) return { erro: "Escolha o seu condomínio." };
  if (!itens.length) return { erro: "Escolha ao menos um produto." };
  if (nome.length < 2) return { erro: "Informe seu nome." };
  if (!telefoneValido(telefone)) return { erro: "Informe o WhatsApp com DDD." };

  const sb = clienteServico();
  const { data, error } = await sb.rpc("criar_solicitacao", {
    p_itens: itens,
    p_nome: nome,
    p_telefone: telefone,
    p_modalidade: tipo === "condominio" ? "entrega" : tipo,
    p_endereco: tipo === "entrega" ? String(d.get("endereco") ?? "") : "",
    p_observacoes: String(d.get("observacoes") ?? ""),
    p_origem_hash: await origemAnonima(),
    p_condominio_id: condominio || null,
    p_bloco: condominio ? String(d.get("bloco") ?? "") : null,
    p_apto: condominio ? String(d.get("apto") ?? "") : null,
  });
  if (error) {
    return { erro: error.code === "P0001" ? error.message : "Não foi possível registrar o pedido agora. Tente de novo em instantes." };
  }
  const linha = Array.isArray(data) ? data[0] : data;
  if (d.get("aceita_novidades") === "on") {
    // Não bloqueia o pedido se falhar
    await sb.rpc("registrar_aceite_novidades", { p_telefone: telefone, p_origem: "pedido" }).then(() => {}, () => {});
  }
  redirect(`/pedido/${linha.token}`);
}

type Preparo = { erro: string } | { caminho: string; tokenEnvio: string };

/** Passo 1 do envio: confere a solicitação e libera um endereço de upload privado, de uso único. */
export async function prepararComprovante(token: string, tipo: string, tamanho: number): Promise<Preparo> {
  if (!TOKEN_VALIDO.test(token)) return { erro: "Link inválido." };
  if (!(TIPOS_ACEITOS as readonly string[]).includes(tipo)) return { erro: "Envie uma imagem JPG, PNG, WebP ou um PDF." };
  if (!Number.isFinite(tamanho) || tamanho <= 0 || tamanho > TAMANHO_MAXIMO) return { erro: "O arquivo passa de 8 MB." };
  const sb = clienteServico();
  const { data: s } = await sb.from("solicitacoes").select("id, status, comprovante_ate").eq("token", token).maybeSingle();
  if (!s) return { erro: "Pedido não encontrado." };
  if (!["aguardando_pagamento", "em_conferencia"].includes(s.status)) return { erro: "Este pedido já foi analisado." };
  if (new Date(s.comprovante_ate) < new Date()) return { erro: "O prazo para enviar o comprovante terminou. Fale com a gente pelo WhatsApp." };
  const caminho = `solicitacoes/${s.id}/${crypto.randomUUID()}.${EXTENSAO[tipo as TipoAceito]}`;
  const { data, error } = await sb.storage.from("comprovantes").createSignedUploadUrl(caminho);
  if (error || !data) return { erro: "Não foi possível preparar o envio. Tente de novo." };
  return { caminho, tokenEnvio: data.token };
}

/** Passo 2: confere o conteúdo real do arquivo no servidor e registra a pendência. */
export async function confirmarComprovante(token: string, caminho: string): Promise<{ erro?: string; ok?: boolean }> {
  if (!TOKEN_VALIDO.test(token) || !/^solicitacoes\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/.test(caminho)) {
    return { erro: "Envio inválido." };
  }
  const sb = clienteServico();
  const descartar = () => sb.storage.from("comprovantes").remove([caminho]);
  const { data: arquivo, error } = await sb.storage.from("comprovantes").download(caminho);
  if (error || !arquivo) return { erro: "Não recebemos o arquivo. Tente de novo." };
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const v = validarComprovante(bytes);
  if (!v.ok) {
    await descartar();
    return { erro: v.erro };
  }
  const { error: e2 } = await sb.rpc("registrar_comprovante", {
    p_token: token,
    p_storage_path: caminho,
    p_mime: v.tipo,
    p_tamanho: bytes.length,
  });
  if (e2) {
    await descartar();
    return { erro: e2.code === "P0001" ? e2.message : "Não foi possível registrar o comprovante." };
  }
  return { ok: true };
}
