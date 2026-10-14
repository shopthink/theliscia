import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_PUBLICA, SUPABASE_URL } from "@/lib/env";

/** Cliente com a sessão do usuário logado: o banco aplica RLS e is_admin(). */
export async function clienteDaSessao() {
  const jar = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLICA, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (lista) => {
        try {
          lista.forEach(({ name, value, options }) => jar.set(name, value, options));
        } catch {
          // Em Server Components não dá para gravar cookies; o proxy renova a sessão.
        }
      },
    },
  });
}
