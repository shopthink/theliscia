import Link from "next/link";
import { exigirAdmin } from "@/lib/auth";

export const metadata = { title: "Fechamento" };

export default async function EmBreve() {
  await exigirAdmin();
  return (
    <>
      <div className="cabecalho"><h1>Fechamento</h1></div>
      <div className="cartao vazio">
        <p>Esta área chega na <strong>fase 4</strong>: CMV, resultado operacional e fechamento mensal com trava.</p>
        <Link href="/admin">Voltar ao início</Link>
      </div>
    </>
  );
}
