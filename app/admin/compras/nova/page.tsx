import Link from "next/link";
import { exigirAdmin } from "@/lib/auth";
import { FormCompra } from "../FormCompra";

export const metadata = { title: "Nova compra" };

export default async function NovaCompra() {
  const { supabase } = await exigirAdmin();
  const [{ data: insumos }, { data: fornecedores }, { data: cfg }] = await Promise.all([
    supabase.from("insumos").select("id, nome, unidade, controla_estoque, insumo_embalagens(id, nome, conteudo, unidade, marca_id, ativo), marcas(id, nome, em_uso, ativo)").eq("ativo", true).order("nome"),
    supabase.from("fornecedores").select("id, nome").eq("ativo", true).order("nome"),
    supabase.from("configuracoes").select("valor_hora_centavos").single(),
  ]);
  return (
    <>
      <div className="cabecalho">
        <div>
          <Link href="/admin/compras" className="suave">← Compras</Link>
          <h1>Nova compra</h1>
        </div>
      </div>
      <FormCompra insumos={(insumos ?? []).map((i: any) => ({ ...i, embalagens: (i.insumo_embalagens ?? []).filter((e: any) => e.ativo).map((e: any) => ({ ...e, conteudo: Number(e.conteudo) })) }))} fornecedores={fornecedores ?? []} valorHora={cfg?.valor_hora_centavos ?? 0} />
    </>
  );
}
