import "server-only";
import { redirect } from "next/navigation";
import { clienteDaSessao } from "@/lib/supabase/servidor";

/**
 * Exige o administrador em cada página e ação do painel.
 * O banco repete a verificação (RLS + is_admin()), então a interface não é a única barreira.
 */
export async function exigirAdmin() {
  const supabase = await clienteDaSessao();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const { data: admin, error } = await supabase.rpc("is_admin");
  if (error || admin !== true) redirect("/login?erro=sem-acesso");
  return { supabase, usuario: data.user };
}
