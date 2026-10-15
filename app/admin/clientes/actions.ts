"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { exigirAdmin } from "@/lib/auth";
import { CONFLITO, mensagemDoBanco, type EstadoForm } from "@/lib/erros";
import { normalizarTelefone, telefoneValido } from "@/lib/telefone";
import { lerEtiquetas, ORIGENS } from "@/lib/crm";

const txt = (d: FormData, k: string) => {
  const v = String(d.get(k) ?? "").trim();
  return v === "" ? null : v;
};

function camposComuns(d: FormData) {
  const condominio = txt(d, "condominio_id");
  return {
    nome: txt(d, "nome") ?? "",
    origem: txt(d, "origem") ?? "outro",
    anotacoes: txt(d, "anotacoes"),
    etiquetas: lerEtiquetas(String(d.get("etiquetas") ?? "")),
    condominio_id: condominio,
    bloco: condominio ? txt(d, "bloco") : null,
    apto: condominio ? txt(d, "apto") : null,
  };
}

function validar(c: ReturnType<typeof camposComuns>): string | null {
  if (c.nome.length < 2) return "Informe o nome.";
  if (!(c.origem in ORIGENS)) return "Escolha a origem.";
  if ((c.anotacoes?.length ?? 0) > 2000) return "Anotações muito longas.";
  return null;
}

export async function criarLead(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const c = camposComuns(d);
  const erro = validar(c);
  if (erro) return { erro };
  const tel = String(d.get("telefone") ?? "");
  if (!telefoneValido(tel)) return { erro: "Informe o WhatsApp com DDD." };
  const aceita = d.get("aceita_novidades") === "on";
  const { data, error } = await supabase.from("clientes").insert({
    ...c,
    telefone: normalizarTelefone(tel),
    aceita_novidades: aceita,
    aceite_em: aceita ? new Date().toISOString() : null,
    aceite_origem: aceita ? "manual" : null,
  }).select("id").single();
  if (error) {
    if (error.code === "23505") {
      const { data: existe } = await supabase.from("clientes").select("id").eq("telefone", normalizarTelefone(tel)).maybeSingle();
      return { erro: existe ? "Esse WhatsApp já está cadastrado. Busque pelo número na lista de clientes." : mensagemDoBanco(error) };
    }
    return { erro: mensagemDoBanco(error) };
  }
  revalidatePath("/admin/clientes");
  redirect(`/admin/clientes/${data.id}?criado=1`);
}

export async function salvarCliente(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const id = String(d.get("id"));
  const c = camposComuns(d);
  const erro = validar(c);
  if (erro) return { erro };
  const aceita = d.get("aceita_novidades") === "on";
  const { data: atual } = await supabase.from("clientes").select("aceita_novidades").eq("id", id).single();
  const aceite = atual && aceita !== atual.aceita_novidades
    ? aceita
      ? { aceita_novidades: true, aceite_em: new Date().toISOString(), aceite_origem: "manual" }
      : { aceita_novidades: false, aceite_em: null, aceite_origem: null }
    : {};
  const { data, error } = await supabase.from("clientes").update({ ...c, ...aceite }).eq("id", id).eq("versao", Number(d.get("versao"))).select("id");
  if (error) return { erro: mensagemDoBanco(error) };
  if (!data?.length) return { erro: CONFLITO };
  revalidatePath(`/admin/clientes/${id}`);
  revalidatePath("/admin/clientes");
  return { ok: "Cliente salvo." };
}
