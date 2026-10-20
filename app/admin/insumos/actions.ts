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

function erroInsumo(e: { code?: string; message?: string }) {
  if (e.code === "23505" && e.message?.includes("uso_auxiliar")) return "Outro insumo já entra automaticamente com esse uso. Troque lá primeiro.";
  return mensagemDoBanco(e);
}

export async function salvarInsumo(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const id = String(d.get("id") ?? "");
  const nome = String(d.get("nome") ?? "").trim();
  const unidade = String(d.get("unidade") ?? "");
  if (!nome) return { erro: "Informe o nome." };
  if (!["g", "ml", "un"].includes(unidade)) return { erro: "Unidade inválida." };
  const uso = String(d.get("uso_auxiliar") ?? "");
  if (uso && !["semola", "saco_vacuo", "etiqueta", "molho", "sacola"].includes(uso)) return { erro: "Uso automático inválido." };
  const preco = precoPorUnidadeBase(String(d.get("preco") ?? ""), unidade);
  if (preco === "invalido") return { erro: "Preço inválido. Use, por exemplo, 6,50." };
  const linha = {
    nome,
    unidade,
    categoria: String(d.get("categoria") ?? "ingrediente"),
    preco_ref_centavos: preco,
    entra_lista_compras: d.get("entra_lista_compras") === "on",
    controla_estoque: d.get("controla_estoque") === "on",
    uso_auxiliar: String(d.get("uso_auxiliar") ?? "") || null,
    observacoes: String(d.get("observacoes") ?? "").trim() || null,
    ativo: id ? d.get("ativo") === "on" : true,
  };
  if (id) {
    const { data, error } = await supabase.from("insumos").update(linha).eq("id", id).eq("versao", Number(d.get("versao"))).select("id");
    if (error) return { erro: erroInsumo(error) };
    if (!data?.length) return { erro: CONFLITO };
  } else {
    const { error } = await supabase.from("insumos").insert(linha);
    if (error) return { erro: erroInsumo(error) };
  }
  revalidatePath("/admin/insumos", "layout");
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
  const insumoId = String(d.get("insumo_id"));
  const marcaId = String(d.get("marca_id") ?? "") || null;
  const { error } = await supabase.from("insumo_embalagens").insert({ insumo_id: insumoId, marca_id: marcaId, nome, conteudo, unidade });
  if (error) return { erro: error.code === "23505" ? "Essa embalagem já está cadastrada." : mensagemDoBanco(error) };
  revalidatePath("/admin/insumos", "layout");
  return { ok: "Embalagem adicionada." };
}

export async function removerEmbalagem(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const { error } = await supabase.from("insumo_embalagens").delete().eq("id", String(d.get("id")));
  if (error) return { erro: mensagemDoBanco(error) };
  revalidatePath("/admin/insumos", "layout");
  return { ok: "Embalagem removida." };
}

const CAMPOS_NUTRI = ["kcal", "carboidratos_g", "acucares_totais_g", "acucares_adic_g", "proteinas_g", "gorduras_g", "saturadas_g", "trans_g", "fibras_g", "sodio_mg"];

function lerNutricao(d: FormData): Record<string, number | string | null> | string {
  const linha: Record<string, number | string | null> = {};
  const vazios = CAMPOS_NUTRI.filter((c) => String(d.get(c) ?? "").trim() === "");
  if (vazios.length && vazios.length < CAMPOS_NUTRI.length) return "Preencha todos os campos (use 0 quando não tiver) ou deixe todos vazios.";
  for (const c of CAMPOS_NUTRI) {
    const t = String(d.get(c) ?? "").trim().replace(",", ".");
    if (t === "") { linha[`nutri_${c}`] = null; continue; }
    const v = Number(t);
    if (!Number.isFinite(v) || v < 0) return "Use apenas números positivos.";
    linha[`nutri_${c}`] = v;
  }
  linha.nutri_fonte = String(d.get("fonte") ?? "").trim() || null;
  return linha;
}

export async function salvarNutricaoInsumo(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const linha = lerNutricao(d);
  if (typeof linha === "string") return { erro: linha };
  const marca = String(d.get("marca_id") ?? "");
  const { error } = marca
    ? await supabase.from("marcas").update(linha).eq("id", marca)
    : await supabase.from("insumos").update(linha).eq("id", String(d.get("id")));
  if (error) return { erro: mensagemDoBanco(error) };
  revalidatePath("/admin/insumos", "layout");
  revalidatePath("/admin/receitas", "layout");
  return { ok: marca ? "Tabela nutricional da marca salva." : "Tabela genérica do insumo salva." };
}

export async function salvarMarca(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const id = String(d.get("id") ?? "");
  const insumo = String(d.get("insumo_id"));
  const nome = String(d.get("nome") ?? "").trim();
  if (!nome) return { erro: "Informe o nome da marca." };
  const linha = {
    nome,
    nome_rotulo: String(d.get("nome_rotulo") ?? "").trim() || null,
    notas: String(d.get("notas") ?? "").trim() || null,
    ...(id ? { ativo: d.get("ativo") === "on" } : {}),
  };
  if (id) {
    const { data, error } = await supabase.from("marcas").update(linha).eq("id", id).eq("versao", Number(d.get("versao"))).select("id");
    if (error) return { erro: error.code === "23505" ? "Já existe uma marca com esse nome neste insumo." : mensagemDoBanco(error) };
    if (!data?.length) return { erro: CONFLITO };
  } else {
    const { data, error } = await supabase.from("marcas").insert({ ...linha, insumo_id: insumo }).select("id").single();
    if (error) return { erro: error.code === "23505" ? "Já existe uma marca com esse nome neste insumo." : mensagemDoBanco(error) };
    if (d.get("em_uso") === "on") await supabase.rpc("definir_marca_em_uso", { p_marca_id: data.id });
  }
  revalidatePath(`/admin/insumos/${insumo}`);
  return { ok: id ? "Marca salva." : "Marca cadastrada." };
}

export async function usarMarca(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const { error } = await supabase.rpc("definir_marca_em_uso", { p_marca_id: String(d.get("id")) });
  if (error) return { erro: mensagemDoBanco(error) };
  revalidatePath(`/admin/insumos/${String(d.get("insumo_id"))}`);
  return { ok: "Marca em uso atualizada. Os próximos lotes começam com ela." };
}
