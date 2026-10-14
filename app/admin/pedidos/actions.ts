"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { exigirAdmin } from "@/lib/auth";
import { CONFLITO, mensagemDoBanco, type EstadoForm } from "@/lib/erros";
import { lerBRL } from "@/lib/dinheiro";

const STATUS_PRODUCAO = ["confirmado", "em_producao", "pronto", "entregue", "cancelado"];
const METODOS = ["pix", "dinheiro", "cartao", "outro"];

/** "2026-10-14T10:30" digitado no painel = horário de São Paulo (UTC−3, sem horário de verão desde 2019). */
function dataHoraSP(v: string | null): string | null {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  return new Date(`${v}:00-03:00`).toISOString();
}

export async function aprovar(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const id = String(d.get("id"));
  if (d.get("conferi") !== "on") return { erro: "Confirme que você conferiu o crédito no extrato do banco." };
  const valor = lerBRL(String(d.get("valor") ?? ""));
  if (!valor || valor <= 0) return { erro: "Informe o valor que caiu na conta." };
  const { data, error } = await supabase.rpc("aprovar_solicitacao", {
    p_solicitacao_id: id,
    p_valor_centavos: valor,
    p_referencia: String(d.get("referencia") ?? "") || null,
    p_recebido_em: dataHoraSP(String(d.get("recebido_em") ?? "")) ?? new Date().toISOString(),
  });
  if (error) return { erro: mensagemDoBanco(error) };
  revalidatePath("/admin", "layout");
  redirect(`/admin/pedidos/${data}?aprovado=1`);
}

export async function recusar(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const id = String(d.get("id"));
  const motivo = String(d.get("motivo") ?? "").trim();
  if (!motivo) return { erro: "Escreva o motivo (fica registrado)." };
  const { error } = await supabase.rpc("recusar_solicitacao", { p_solicitacao_id: id, p_motivo: motivo });
  if (error) return { erro: mensagemDoBanco(error) };
  revalidatePath("/admin", "layout");
  redirect(`/admin/pedidos?aba=conferencia&recusado=1`);
}

export async function mudarStatusProducao(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const id = String(d.get("id"));
  const status = String(d.get("status"));
  if (!STATUS_PRODUCAO.includes(status)) return { erro: "Status inválido." };
  const { data, error } = await supabase
    .from("pedidos")
    .update({ status_producao: status, entregue_em: status === "entregue" ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("versao", Number(d.get("versao")))
    .select("id");
  if (error) return { erro: mensagemDoBanco(error) };
  if (!data?.length) return { erro: CONFLITO };
  revalidatePath(`/admin/pedidos/${id}`);
  return { ok: "Status atualizado." };
}

export async function registrarPagamento(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase, usuario } = await exigirAdmin();
  const pedido = String(d.get("pedido_id"));
  const valor = lerBRL(String(d.get("valor") ?? ""));
  const metodo = String(d.get("metodo"));
  if (!valor || valor <= 0) return { erro: "Informe o valor recebido." };
  if (!METODOS.includes(metodo)) return { erro: "Escolha a forma de pagamento." };
  const { data: p } = await supabase.from("pedidos").select("total_centavos, recebido_centavos").eq("id", pedido).single();
  if (p && p.recebido_centavos + valor > p.total_centavos) {
    return { erro: `O valor passa do saldo em aberto (${((p.total_centavos - p.recebido_centavos) / 100).toFixed(2).replace(".", ",")}).` };
  }
  const { error } = await supabase.from("pagamentos").insert({
    pedido_id: pedido,
    valor_centavos: valor,
    metodo,
    referencia: String(d.get("referencia") ?? "").trim() || null,
    recebido_em: dataHoraSP(String(d.get("recebido_em") ?? "")) ?? new Date().toISOString(),
    conferido_por: usuario.id,
  });
  if (error) return { erro: mensagemDoBanco(error) };
  revalidatePath(`/admin/pedidos/${pedido}`);
  return { ok: "Pagamento registrado." };
}

export async function removerPagamento(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const pedido = String(d.get("pedido_id"));
  const { error } = await supabase.from("pagamentos").delete().eq("id", String(d.get("id"))).is("solicitacao_id", null);
  if (error) return { erro: mensagemDoBanco(error) };
  revalidatePath(`/admin/pedidos/${pedido}`);
  return { ok: "Pagamento removido." };
}

export async function criarPedidoManual(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  let itens: { receita_id: string; quantidade: number; preco_centavos: number }[];
  try {
    itens = JSON.parse(String(d.get("itens") ?? "[]"));
  } catch {
    return { erro: "Itens inválidos." };
  }
  itens = itens.filter((i) => i.receita_id && i.quantidade > 0);
  if (!itens.length) return { erro: "Adicione ao menos um item." };
  const valorPago = lerBRL(String(d.get("valor_pago") ?? "")) ?? 0;
  const { data, error } = await supabase.rpc("criar_pedido_manual", {
    p_nome: String(d.get("nome") ?? ""),
    p_telefone: String(d.get("telefone") ?? ""),
    p_modalidade: String(d.get("modalidade") ?? ""),
    p_endereco: String(d.get("endereco") ?? ""),
    p_entrega_em: String(d.get("entrega_em") ?? "") || null,
    p_observacoes: String(d.get("observacoes") ?? ""),
    p_itens: itens,
    p_campanha_id: String(d.get("campanha_id") ?? "") || null,
    p_pagamento: valorPago > 0
      ? { valor_centavos: valorPago, metodo: String(d.get("metodo") ?? "pix"), referencia: String(d.get("referencia") ?? "") }
      : null,
  });
  if (error) return { erro: mensagemDoBanco(error) };
  revalidatePath("/admin/pedidos");
  redirect(`/admin/pedidos/${data}?criado=1`);
}
