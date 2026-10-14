"use server";
import { revalidatePath } from "next/cache";
import { exigirAdmin } from "@/lib/auth";
import { mensagemDoBanco, type EstadoForm } from "@/lib/erros";

export async function salvarNovaVersao(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const id = String(d.get("receita_id"));
  const peso = Number(String(d.get("peso_bolinha_g") ?? "").replace(",", "."));
  if (!(peso > 0 && peso < 2000)) return { erro: "Peso da bolinha inválido." };
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
    p_peso_bolinha_g: peso,
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
  const { data, error } = await supabase.from("receitas").insert({ nome, codigo }).select("id").single();
  if (error) return { erro: error.code === "23505" ? "Já existe uma receita com esse nome." : mensagemDoBanco(error) };
  revalidatePath("/admin/receitas");
  return { ok: "Receita criada. Abra-a para cadastrar a ficha técnica.", dados: { id: data.id } };
}
