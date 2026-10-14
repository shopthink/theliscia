"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { exigirAdmin } from "@/lib/auth";
import { CONFLITO, mensagemDoBanco, type EstadoForm } from "@/lib/erros";
import { validarDatasCampanha } from "@/lib/datas";
import { lerBRL } from "@/lib/dinheiro";

const txt = (d: FormData, k: string) => {
  const v = String(d.get(k) ?? "").trim();
  return v === "" ? null : v;
};

function lerCampanha(d: FormData) {
  return {
    nome: txt(d, "nome") ?? "",
    abre_em: txt(d, "abre_em") ?? "",
    fecha_em: txt(d, "fecha_em") ?? "",
    entrega_em: txt(d, "entrega_em") ?? "",
    permite_entrega: d.get("permite_entrega") === "on",
    permite_retirada: d.get("permite_retirada") === "on",
    instrucoes_entrega: txt(d, "instrucoes_entrega"),
    regiao_atendida: txt(d, "regiao_atendida"),
    retirada_info: txt(d, "retirada_info"),
    frete_info: txt(d, "frete_info"),
    pedido_minimo: Number(d.get("pedido_minimo") ?? 3),
    pix_chave: txt(d, "pix_chave"),
    pix_favorecido: txt(d, "pix_favorecido"),
    pix_cidade: txt(d, "pix_cidade") ?? "Sao Paulo",
    percentual_sinal: Number(d.get("percentual_sinal") ?? 100),
    horas_envio_comprovante: Number(d.get("horas_envio_comprovante") ?? 24),
  };
}

function validar(c: ReturnType<typeof lerCampanha>): string | null {
  if (!c.nome) return "Dê um nome à campanha, por exemplo “Outubro/2026”.";
  const erroData = validarDatasCampanha(c.abre_em, c.fecha_em, c.entrega_em);
  if (erroData) return erroData;
  if (!c.permite_entrega && !c.permite_retirada) return "Permita entrega, retirada ou as duas.";
  if (!Number.isInteger(c.pedido_minimo) || c.pedido_minimo < 1) return "O pedido mínimo deve ser pelo menos 1 base.";
  if (![50, 100].includes(c.percentual_sinal)) return "Escolha 100% ou 50% de sinal.";
  if (!Number.isInteger(c.horas_envio_comprovante) || c.horas_envio_comprovante < 1 || c.horas_envio_comprovante > 168)
    return "O prazo do comprovante deve ficar entre 1 e 168 horas.";
  return null;
}

export async function criarCampanha(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const c = lerCampanha(d);
  const erro = validar(c);
  if (erro) return { erro };
  const { data, error } = await supabase.from("campanhas").insert({ ...c, ativa: false }).select("id").single();
  if (error) return { erro: mensagemDoBanco(error) };
  // Copia os produtos da campanha anterior, se pedido (preços podem ser revistos depois)
  const copiarDe = txt(d, "copiar_de");
  if (copiarDe) {
    const { data: prods } = await supabase
      .from("campanha_produtos")
      .select("receita_id, nome, descricao, preco_centavos, foto_url, ordem, ativo")
      .eq("campanha_id", copiarDe);
    if (prods?.length) await supabase.from("campanha_produtos").insert(prods.map((p) => ({ ...p, campanha_id: data.id })));
  }
  revalidatePath("/admin/campanhas");
  redirect(`/admin/campanhas/${data.id}?criada=1`);
}

export async function salvarCampanha(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const id = String(d.get("id"));
  const versao = Number(d.get("versao"));
  const c = lerCampanha(d);
  const erro = validar(c);
  if (erro) return { erro };
  const { data, error } = await supabase.from("campanhas").update(c).eq("id", id).eq("versao", versao).select("id");
  if (error) return { erro: mensagemDoBanco(error) };
  if (!data?.length) return { erro: CONFLITO };
  revalidatePath(`/admin/campanhas/${id}`);
  revalidatePath("/pedido");
  return { ok: "Campanha salva. Pedidos já iniciados mantêm os valores e a data que o cliente viu." };
}

export async function alternarVendas(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const id = String(d.get("id"));
  const ativar = d.get("ativar") === "1";
  const { data, error } = await supabase
    .from("campanhas")
    .update({ ativa: ativar })
    .eq("id", id)
    .eq("versao", Number(d.get("versao")))
    .select("id");
  if (error) return { erro: mensagemDoBanco(error) };
  if (!data?.length) return { erro: CONFLITO };
  revalidatePath(`/admin/campanhas/${id}`);
  revalidatePath("/admin/campanhas");
  revalidatePath("/pedido");
  return { ok: ativar ? "Vendas ativadas. O link público já aceita pedidos dentro da janela." : "Vendas pausadas." };
}

export async function salvarProduto(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const campanhaId = String(d.get("campanha_id"));
  const id = txt(d, "id");
  const preco = lerBRL(String(d.get("preco") ?? ""));
  const nome = txt(d, "nome");
  const receita = txt(d, "receita_id");
  if (!nome) return { erro: "Informe o nome do produto." };
  if (!receita) return { erro: "Escolha a receita interna." };
  if (!preco || preco <= 0) return { erro: "Informe um preço válido, por exemplo 25,00." };
  const linha = {
    campanha_id: campanhaId,
    receita_id: receita,
    nome,
    descricao: txt(d, "descricao"),
    preco_centavos: preco,
    foto_url: txt(d, "foto_url"),
    ordem: Number(d.get("ordem") ?? 0) || 0,
    ativo: d.get("ativo") === "on",
  };
  if (linha.foto_url && !/^https:\/\//.test(linha.foto_url)) return { erro: "A foto precisa ser um endereço https://." };
  const { error } = id
    ? await supabase.from("campanha_produtos").update(linha).eq("id", id)
    : await supabase.from("campanha_produtos").insert(linha);
  if (error) return { erro: mensagemDoBanco(error) };
  revalidatePath(`/admin/campanhas/${campanhaId}`);
  revalidatePath("/pedido");
  return { ok: id ? "Produto atualizado." : "Produto adicionado." };
}

export async function removerProduto(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const id = String(d.get("id"));
  const campanhaId = String(d.get("campanha_id"));
  const { error } = await supabase.from("campanha_produtos").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      // Já usado em solicitações: só desativa, para manter o histórico
      const r = await supabase.from("campanha_produtos").update({ ativo: false }).eq("id", id);
      if (r.error) return { erro: mensagemDoBanco(r.error) };
      revalidatePath(`/admin/campanhas/${campanhaId}`);
      return { ok: "Produto já tinha pedidos: foi desativado em vez de excluído." };
    }
    return { erro: mensagemDoBanco(error) };
  }
  revalidatePath(`/admin/campanhas/${campanhaId}`);
  revalidatePath("/pedido");
  return { ok: "Produto removido." };
}
