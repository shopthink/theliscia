import Link from "next/link";
import { exigirAdmin } from "@/lib/auth";

export const metadata = { title: "Compras e estoque" };

export default async function EmBreve() {
  await exigirAdmin();
  return (
    <>
      <div className="cabecalho"><h1>Compras e estoque</h1></div>
      <div className="cartao vazio">
        <p>Esta área chega na <strong>fase 2</strong>: compras com vários insumos, fornecedores, leitura do cupom, rateio de frete e estoque.</p>
        <Link href="/admin">Voltar ao início</Link>
      </div>
    </>
  );
}
