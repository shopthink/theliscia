import Link from "next/link";
import { exigirAdmin } from "@/lib/auth";

export const metadata = { title: "Produção" };

export default async function EmBreve() {
  await exigirAdmin();
  return (
    <>
      <div className="cabecalho"><h1>Produção</h1></div>
      <div className="cartao vazio">
        <p>Esta área chega na <strong>fase 3</strong>: lotes por receita, cálculo da massa, horas de trabalho ativo e perdas.</p>
        <Link href="/admin">Voltar ao início</Link>
      </div>
    </>
  );
}
