"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirAdmin } from "@/lib/auth";
import { mensagemDoBanco, type EstadoForm } from "@/lib/erros";

export async function salvarNovaVersao(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const id = String(d.get("receita_id"));
  const tipo = String(d.get("tipo") ?? "base");
  const peso = Number(String(d.get("peso_bolinha_g") ?? "").replace(",", "."));
  const rendimento = Number(String(d.get("rendimento") ?? "").replace(",", "."));
  if (tipo === "base" && !(peso > 0 && peso < 2000)) return { erro: "Peso da bolinha inválido." };
  if (tipo === "preparo" && !(rendimento > 0)) return { erro: "Informe quanto a receita rende." };
  let ings: { insumo_id: string; quantidade: number; densidade_g: number }[];
  try {
    ings = JSON.parse(String(d.get("ingredientes") ?? "[]"));
  } catch {
    return { erro: "Ingredientes inválidos." };
  }
  ings = ings.filter((i) => i.insumo_id && i.quantidade > 0);
  if (!ings.length) return { erro: "Informe ao menos um ingrediente." };
  if (new Set(ings.map((i) => i.insumo_id)).size !== ings.length) return { erro: "Há um insumo repetido." };
  if (ings.some((i) => !(i.densidade_g > 0))) return { erro: "Densidade inválida." };
  const { error } = await supabase.rpc("nova_versao_receita", {
    p_receita_id: id,
    p_peso_bolinha_g: tipo === "base" ? peso : null,
    p_rendimento: tipo === "preparo" ? rendimento : null,
    p_ingredientes: ings,
    p_observacoes: String(d.get("observacoes") ?? "").trim() || null,
  });
  if (error) return { erro: mensagemDoBanco(error) };
  revalidatePath(`/admin/receitas/${id}`);
  revalidatePath("/admin/receitas");
  return { ok: "Nova versão salva. Pedidos e lotes anteriores continuam com a versão antiga." };
}

export async function criarReceita(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const nome = String(d.get("nome") ?? "").trim();
  const codigo = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  if (codigo.length < 2) return { erro: "Informe o nome da receita." };
  const tipo = String(d.get("tipo") ?? "base") === "preparo" ? "preparo" : "base";
  const produz = String(d.get("produz_insumo_id") ?? "") || null;
  if (tipo === "preparo" && !produz) return { erro: "Escolha qual insumo este preparo produz (ex.: Molho de marcação)." };
  const { data, error } = await supabase.from("receitas").insert({ nome, codigo, tipo, produz_insumo_id: tipo === "preparo" ? produz : null }).select("id").single();
  if (error) return { erro: error.code === "23505" ? "Já existe uma receita com esse nome." : mensagemDoBanco(error) };
  revalidatePath("/admin/receitas");
  redirect(`/admin/receitas/${data.id}?nova=1`);
}

export async function salvarRotulo(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const id = String(d.get("receita_id"));
  const num = (k: string) => {
    const t = String(d.get(k) ?? "").trim().replace(",", ".");
    if (!t) return null;
    const v = Number(t);
    return Number.isFinite(v) && v > 0 ? v : NaN;
  };
  const linha = {
    rotulo_nome: String(d.get("rotulo_nome") ?? "").trim() || null,
    rotulo_alergenicos: String(d.get("rotulo_alergenicos") ?? "").trim() || null,
    rotulo_conservacao: String(d.get("rotulo_conservacao") ?? "").trim() || null,
    rotulo_preparo: String(d.get("rotulo_preparo") ?? "").trim() || null,
    validade_dias: num("validade_dias"),
    peso_assado_g: num("peso_assado_g"),
    porcao_g: num("porcao_g"),
    porcao_medida: String(d.get("porcao_medida") ?? "").trim() || null,
  };
  if ([linha.validade_dias, linha.peso_assado_g, linha.porcao_g].some((v) => Number.isNaN(v))) return { erro: "Use números positivos." };
  if (linha.validade_dias != null) linha.validade_dias = Math.round(linha.validade_dias);
  const { error } = await supabase.from("receitas").update(linha).eq("id", id);
  if (error) return { erro: mensagemDoBanco(error) };
  revalidatePath(`/admin/receitas/${id}`);
  return { ok: "Dados do rótulo salvos." };
}

export async function validarNutricao(
  receitaId: string, valores: Record<string, number>, marcas: Record<string, string | null>, ingredientes: string,
): Promise<{ erro?: string; ok?: string }> {
  const { supabase } = await exigirAdmin();
  const { error } = await supabase.rpc("validar_nutricao", {
    p_receita_id: receitaId, p_valores: valores, p_marcas: marcas, p_ingredientes: ingredientes,
  });
  if (error) return { erro: mensagemDoBanco(error) };
  revalidatePath(`/admin/receitas/${receitaId}`);
  revalidatePath("/admin/etiquetas");
  return { ok: "Tabela validada para esta combinação de marcas. Os lotes com estas marcas já podem imprimir etiqueta." };
}
