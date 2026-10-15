import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface FiltrosClientes { seg?: string; q?: string; novidades?: string; cond?: string; etiqueta?: string }

export const CAMPOS_RESUMO =
  "id, nome, telefone, condominio_id, condominio_nome, condominio_slug, bloco, apto, aceita_novidades, origem, etiquetas, pedidos, bases, total_centavos, primeiro_pedido_em, ultimo_pedido_em, nao_pagas, ultima_tentativa_em, segmento, fa, criado_em";

/** Mesma consulta para a lista e para a exportação. */
export function consultarClientes(sb: SupabaseClient, f: FiltrosClientes, limite = 1000) {
  let q = sb.from("clientes_resumo").select(CAMPOS_RESUMO);
  if (f.seg === "fa") q = q.eq("fa", true);
  else if (f.seg && ["lead", "novo", "recorrente", "sumido"].includes(f.seg)) q = q.eq("segmento", f.seg);
  if (f.novidades === "1") q = q.eq("aceita_novidades", true);
  if (f.cond && /^[0-9a-f-]{36}$/.test(f.cond)) q = q.eq("condominio_id", f.cond);
  if (f.etiqueta) q = q.contains("etiquetas", [f.etiqueta.toLowerCase().slice(0, 30)]);
  const busca = (f.q ?? "").replace(/[,()*%\\]/g, " ").trim().slice(0, 60);
  if (busca) {
    const dig = busca.replace(/\D/g, "");
    q = dig.length >= 4 && dig.length === busca.replace(/[\s().-]/g, "").length
      ? q.ilike("telefone", `%${dig}%`)
      : q.ilike("nome", `%${busca}%`);
  }
  return q
    .order("ultimo_pedido_em", { ascending: false, nullsFirst: false })
    .order("criado_em", { ascending: false })
    .limit(limite);
}
