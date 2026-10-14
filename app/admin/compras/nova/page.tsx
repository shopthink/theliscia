import Link from "next/link";
import { exigirAdmin } from "@/lib/auth";
import { FormCompra } from "../FormCompra";

export const metadata = { title: "Nova compra" };

export default async function NovaCompra() {
  const { supabase } = await exigirAdmin();
  const [{ data: insumos }, { data: fornecedores }, { data: cfg }] = await Promise.all([
    supabase.from("insumos").select("id, nome, unidade").eq("ativo", true).order("nome"),
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
      <FormCompra insumos={insumos ?? []} fornecedores={fornecedores ?? []} valorHora={cfg?.valor_hora_centavos ?? 0} />
    </>
  );
}
