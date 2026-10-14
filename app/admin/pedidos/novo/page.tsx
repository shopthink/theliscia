import Link from "next/link";
import { exigirAdmin } from "@/lib/auth";
import { FormPedidoManual } from "./FormPedidoManual";

export const metadata = { title: "Novo pedido" };

export default async function NovoPedido() {
  const { supabase } = await exigirAdmin();
  const [{ data: receitas }, { data: campanhas }] = await Promise.all([
    supabase.from("receitas").select("id, nome").eq("ativa", true).order("nome"),
    supabase.from("campanhas").select("id, nome, ativa, entrega_em, campanha_produtos(receita_id, preco_centavos, ativo)").order("abre_em", { ascending: false }).limit(12),
  ]);
  return (
    <>
      <div className="cabecalho">
        <div>
          <Link href="/admin/pedidos" className="suave">← Pedidos</Link>
          <h1>Novo pedido manual</h1>
          <p className="suave" style={{ margin: 0 }}>Para pedidos recebidos por WhatsApp, buffets ou comércios. Entra direto como confirmado.</p>
        </div>
      </div>
      <FormPedidoManual receitas={receitas ?? []} campanhas={(campanhas ?? []) as any} />
    </>
  );
}
