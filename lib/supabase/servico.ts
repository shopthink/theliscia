import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/env";

/**
 * Cliente com a chave secreta. Usado SOMENTE no servidor, nas ações públicas controladas
 * (ler a campanha ativa, criar solicitação, receber comprovante). Ignora RLS: cada uso
 * seleciona apenas os campos públicos necessários.
 */
export function clienteServico() {
  const chave = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!chave) throw new Error("SUPABASE_SECRET_KEY não configurada.");
  return createClient(SUPABASE_URL, chave, { auth: { persistSession: false, autoRefreshToken: false } });
}
