"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { exigirAdmin } from "@/lib/auth";
import { mensagemDoBanco } from "@/lib/erros";
import { localSPparaISO } from "@/lib/datas";

type R = { erro?: string; ok?: string };

async function rpc(fn: string, args: Record<string, unknown>, lote?: string): Promise<R & { data?: unknown }> {
  const { supabase } = await exigirAdmin();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { erro: mensagemDoBanco(error) };
  revalidatePath("/admin/producao");
  if (lote) revalidatePath(`/admin/producao/${lote}`);
  revalidatePath("/admin", "layout");
  return { data };
}

export async function criarLote(p: {
  receita_id: string;
  data_planejada: string;
  peso_bolinha_g?: number | null;
  item_ids?: string[];
  bases_extras?: number;
  quantidade_planejada?: number | null;
  observacoes?: string;
}): Promise<R> {
  const r = await rpc("criar_lote", { p });
  if (r.erro) return r;
  redirect(`/admin/producao/${r.data}?criado=1`);
}

export async function iniciarEtapa(lote: string, etapa: string): Promise<R> {
  return rpc("iniciar_etapa", { p_lote_id: lote, p_etapa: etapa }, lote);
}

export async function pausar(lote?: string): Promise<R> {
  return rpc("pausar_producao", {}, lote);
}

export async function iniciarEspera(lote: string, tipo: string): Promise<R> {
  return rpc("iniciar_espera", { p_lote_id: lote, p_tipo: tipo }, lote);
}

export async function encerrarEspera(lote: string, espera: string): Promise<R> {
  return rpc("encerrar_espera", { p_espera_id: espera }, lote);
}

export async function marcarLembrete(lote: string, espera: string): Promise<R> {
  return rpc("marcar_lembrete", { p_espera_id: espera }, lote);
}

export async function registrarSessao(lote: string, etapa: string, inicio: string, fim: string, sessao?: string): Promise<R> {
  const i = localSPparaISO(inicio);
  const f = localSPparaISO(fim);
  if (!i || !f) return { erro: "Informe início e fim." };
  const r = await rpc("registrar_sessao", { p_lote_id: lote, p_etapa: etapa, p_inicio: i, p_fim: f, p_sessao_id: sessao ?? null }, lote);
  return r.erro ? r : { ok: sessao ? "Sessão corrigida." : "Sessão lançada." };
}

export async function excluirSessao(lote: string, sessao: string): Promise<R> {
  return rpc("excluir_sessao", { p_sessao_id: sessao }, lote);
}

export async function salvarApontamento(p: {
  id: string;
  versao?: number;
  consumos: { insumo_id: string; quantidade_real: number }[];
  unidades_boas?: number | null;
  perdas?: number | null;
  quantidade_produzida?: number | null;
  observacoes?: string;
}): Promise<R> {
  const r = await rpc("salvar_apontamento_lote", { p }, p.id);
  return r.erro ? r : { ok: "Apontamento salvo." };
}

export async function concluirLote(lote: string): Promise<R> {
  const r = await rpc("concluir_lote", { p_lote_id: lote }, lote);
  revalidatePath("/admin/pedidos");
  revalidatePath("/admin/compras");
  return r.erro ? r : { ok: "Lote concluído. Estoque baixado e custos gravados." };
}

export async function cancelarLote(lote: string, motivo: string): Promise<R> {
  const r = await rpc("cancelar_lote", { p_lote_id: lote, p_motivo: motivo }, lote);
  revalidatePath("/admin/pedidos");
  return r.erro ? r : { ok: "Lote cancelado. Os pedidos voltaram para a fila." };
}
