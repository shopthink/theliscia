"use server";
import { redirect } from "next/navigation";
import { clienteDaSessao } from "@/lib/supabase/servidor";
import type { EstadoForm } from "@/lib/erros";

export async function entrar(_: EstadoForm, dados: FormData): Promise<EstadoForm> {
  const email = String(dados.get("email") ?? "").trim();
  const senha = String(dados.get("senha") ?? "");
  if (!email || !senha) return { erro: "Informe e-mail e senha." };
  const supabase = await clienteDaSessao();
  const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error) return { erro: "E-mail ou senha incorretos." };
  const { data: admin } = await supabase.rpc("is_admin");
  if (admin !== true) {
    await supabase.auth.signOut();
    return { erro: "Esta conta não tem acesso ao painel." };
  }
  redirect("/admin");
}

export async function sair() {
  const supabase = await clienteDaSessao();
  await supabase.auth.signOut();
  redirect("/login");
}
