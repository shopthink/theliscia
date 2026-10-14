import { exigirAdmin } from "@/lib/auth";
import { NavAdmin } from "@/components/NavAdmin";
import { sair } from "@/app/login/actions";

export const metadata = { title: "Painel", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function LayoutAdmin({ children }: { children: React.ReactNode }) {
  const { supabase } = await exigirAdmin();
  const { count } = await supabase
    .from("solicitacoes")
    .select("id", { count: "exact", head: true })
    .eq("status", "em_conferencia");
  return (
    <div className="painel">
      <aside className="lateral">
        <img className="logo" src="/marca/logo-creme.svg" alt="The Liscia Pizzas" />
        <NavAdmin pendentes={count ?? 0} />
        <form action={sair} className="sair">
          <button type="submit">Sair</button>
        </form>
      </aside>
      <main className="conteudo">{children}</main>
    </div>
  );
}
