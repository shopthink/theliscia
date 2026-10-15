"use server";
import { revalidatePath } from "next/cache";
import { exigirAdmin } from "@/lib/auth";
import { CONFLITO, mensagemDoBanco, type EstadoForm } from "@/lib/erros";
import { lerBRL } from "@/lib/dinheiro";

const num = (d: FormData, k: string) => {
  const v = Number(String(d.get(k) ?? "0").replace(",", "."));
  return Number.isFinite(v) && v >= 0 ? v : NaN;
};

export async function salvarConfiguracoes(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const valorHora = lerBRL(String(d.get("valor_hora") ?? "0") || "0");
  if (valorHora == null) return { erro: "Valor da hora inválido." };
  const linha = {
    nome_comercial: String(d.get("nome_comercial") ?? "").trim() || "The Liscia Pizzas",
    whatsapp_contato: String(d.get("whatsapp_contato") ?? "").trim() || null,
    email_contato: String(d.get("email_contato") ?? "").trim() || null,
    instagram: String(d.get("instagram") ?? "").trim() || null,
    valor_hora_centavos: valorHora,
    taxa_percentual: num(d, "taxa_percentual"),
    semola_g_por_base: num(d, "semola_g_por_base"),
    saco_vacuo_por_base: num(d, "saco_vacuo_por_base"),
    etiqueta_por_base: num(d, "etiqueta_por_base"),
    molho_g_por_base: num(d, "molho_g_por_base"),
    sacola_por_pedido: num(d, "sacola_por_pedido"),
    descanso_min: num(d, "descanso_min"),
    dobra_min: num(d, "dobra_min"),
    geladeira_min: Math.round(num(d, "geladeira_h") * 60),
    freezer_min: Math.round(num(d, "freezer_h") * 60),
    esfriar_min: num(d, "esfriar_min"),
  };
  if (Object.values(linha).some((v) => typeof v === "number" && Number.isNaN(v))) return { erro: "Use apenas números positivos." };
  if (linha.taxa_percentual > 100) return { erro: "A taxa deve ficar entre 0 e 100%." };
  const { data, error } = await supabase.from("configuracoes").update(linha).eq("id", true).eq("versao", Number(d.get("versao"))).select("id");
  if (error) return { erro: mensagemDoBanco(error) };
  if (!data?.length) return { erro: CONFLITO };
  revalidatePath("/admin/configuracoes");
  return { ok: "Configurações salvas. Registros já feitos mantêm os valores da época." };
}
