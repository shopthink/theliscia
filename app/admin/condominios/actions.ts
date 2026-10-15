"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { exigirAdmin } from "@/lib/auth";
import { CONFLITO, mensagemDoBanco, type EstadoForm } from "@/lib/erros";
import { gerarSlug, SLUG_VALIDO } from "@/lib/condominios";

const txt = (d: FormData, k: string) => {
  const v = String(d.get(k) ?? "").trim();
  return v === "" ? null : v;
};

function ler(d: FormData) {
  const nome = txt(d, "nome") ?? "";
  const meta = txt(d, "meta_bases");
  return {
    nome,
    slug: gerarSlug(txt(d, "slug") ?? nome),
    endereco: txt(d, "endereco") ?? "",
    forma_entrega: String(d.get("forma_entrega") ?? "portaria"),
    janela_entrega: txt(d, "janela_entrega"),
    instrucoes_cliente: txt(d, "instrucoes_cliente"),
    notas_internas: txt(d, "notas_internas"),
    meta_bases: meta ? Math.floor(Number(meta)) : null,
    ativo: d.get("ativo") === "on",
  };
}

function validar(c: ReturnType<typeof ler>): string | null {
  if (c.nome.length < 2) return "Informe o nome do condomínio.";
  if (!SLUG_VALIDO.test(c.slug)) return "O link precisa ter letras ou números.";
  if (c.endereco.length < 8) return "Informe o endereço completo do condomínio.";
  if (!["portaria", "porta"].includes(c.forma_entrega)) return "Escolha como a entrega acontece.";
  if (c.meta_bases != null && (!Number.isInteger(c.meta_bases) || c.meta_bases < 1 || c.meta_bases > 500)) return "A meta deve ficar entre 1 e 500 bases (ou em branco).";
  return null;
}

export async function criarCondominio(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const c = ler(d);
  const erro = validar(c);
  if (erro) return { erro };
  const { data, error } = await supabase.from("condominios").insert({ ...c, ativo: true }).select("id").single();
  if (error) return { erro: mensagemDoBanco(error) };
  revalidatePath("/admin/condominios");
  redirect(`/admin/condominios/${data.id}?criado=1`);
}

export async function salvarCondominio(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const id = String(d.get("id"));
  const c = ler(d);
  const erro = validar(c);
  if (erro) return { erro };
  const { data, error } = await supabase.from("condominios").update(c).eq("id", id).eq("versao", Number(d.get("versao"))).select("id");
  if (error) return { erro: mensagemDoBanco(error) };
  if (!data?.length) return { erro: CONFLITO };
  revalidatePath(`/admin/condominios/${id}`);
  revalidatePath("/admin/condominios");
  revalidatePath("/pedido");
  return { ok: "Condomínio salvo." };
}
