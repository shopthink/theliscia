"use server";
import { revalidatePath } from "next/cache";
import { exigirAdmin } from "@/lib/auth";
import { CONFLITO, mensagemDoBanco, type EstadoForm } from "@/lib/erros";
import { lerBRL } from "@/lib/dinheiro";

/** Preço digitado por kg/L (g, ml) ou por unidade → centavos por unidade base. */
function precoPorUnidadeBase(texto: string, unidade: string): number | null | "invalido" {
  if (!texto.trim()) return null;
  const c = lerBRL(texto);
  if (c == null) return "invalido";
  return unidade === "un" ? c : c / 1000;
}

export async function salvarInsumo(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const id = String(d.get("id") ?? "");
  const nome = String(d.get("nome") ?? "").trim();
  const unidade = String(d.get("unidade") ?? "");
  if (!nome) return { erro: "Informe o nome." };
  if (!["g", "ml", "un"].includes(unidade)) return { erro: "Unidade inválida." };
  const preco = precoPorUnidadeBase(String(d.get("preco") ?? ""), unidade);
  if (preco === "invalido") return { erro: "Preço inválido. Use, por exemplo, 6,50." };
  const linha = {
    nome,
    unidade,
    categoria: String(d.get("categoria") ?? "ingrediente"),
    preco_ref_centavos: preco,
    entra_lista_compras: d.get("entra_lista_compras") === "on",
    observacoes: String(d.get("observacoes") ?? "").trim() || null,
    ativo: id ? d.get("ativo") === "on" : true,
  };
  if (id) {
    const { data, error } = await supabase.from("insumos").update(linha).eq("id", id).eq("versao", Number(d.get("versao"))).select("id");
    if (error) return { erro: mensagemDoBanco(error) };
    if (!data?.length) return { erro: CONFLITO };
  } else {
    const { error } = await supabase.from("insumos").insert(linha);
    if (error) return { erro: mensagemDoBanco(error) };
  }
  revalidatePath("/admin/insumos");
  return { ok: id ? "Insumo salvo." : "Insumo cadastrado." };
}

export async function salvarEmbalagem(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const conteudo = Number(String(d.get("conteudo") ?? "").replace(",", "."));
  const unidade = String(d.get("unidade") ?? "");
  let nome = String(d.get("nome") ?? "").trim();
  if (!(conteudo > 0)) return { erro: "Informe o conteúdo da embalagem." };
  if (!["g", "kg", "ml", "l", "un"].includes(unidade)) return { erro: "Escolha a unidade." };
  if (!nome) nome = `${unidade === "un" ? "Pacote" : "Embalagem"} ${String(conteudo).replace(".", ",")} ${unidade === "l" ? "L" : unidade}`;
  const { error } = await supabase.from("insumo_embalagens").insert({ insumo_id: String(d.get("insumo_id")), nome, conteudo, unidade });
  if (error) return { erro: error.code === "23505" ? "Essa embalagem já está cadastrada." : mensagemDoBanco(error) };
  revalidatePath("/admin/insumos");
  return { ok: "Embalagem adicionada." };
}

export async function removerEmbalagem(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const { error } = await supabase.from("insumo_embalagens").delete().eq("id", String(d.get("id")));
  if (error) return { erro: mensagemDoBanco(error) };
  revalidatePath("/admin/insumos");
  return { ok: "Embalagem removida." };
}
