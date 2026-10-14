import { NextResponse } from "next/server";
import { clienteDaSessao } from "@/lib/supabase/servidor";

/**
 * Abre um comprovante para o administrador: confere a sessão e gera uma URL assinada de 60 s.
 * O bucket é privado; sem login de administrador a resposta é 403.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await clienteDaSessao();
  const { data: admin } = await supabase.rpc("is_admin");
  if (admin !== true) return new NextResponse("Acesso negado.", { status: 403 });
  const { data: c } = await supabase.from("comprovantes").select("storage_path").eq("id", id).maybeSingle();
  if (!c) return new NextResponse("Não encontrado.", { status: 404 });
  const { data, error } = await supabase.storage.from("comprovantes").createSignedUrl(c.storage_path, 60);
  if (error || !data) return new NextResponse("Não foi possível abrir o arquivo.", { status: 500 });
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "no-store" } });
}
