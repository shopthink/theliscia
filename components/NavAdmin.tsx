"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITENS: { href: string; rotulo: string; grupo?: string; emBreve?: boolean }[] = [
  { href: "/admin", rotulo: "Início" },
  { href: "/admin/pedidos", rotulo: "Pedidos", grupo: "Vendas" },
  { href: "/admin/campanhas", rotulo: "Campanhas" },
  { href: "/admin/condominios", rotulo: "Condomínios" },
  { href: "/admin/compras", rotulo: "Compras e estoque", grupo: "Operação" },
  { href: "/admin/producao", rotulo: "Produção" },
  { href: "/admin/receitas", rotulo: "Receitas" },
  { href: "/admin/insumos", rotulo: "Insumos" },
  { href: "/admin/fechamento", rotulo: "Fechamento", grupo: "Resultado", emBreve: true },
  { href: "/admin/configuracoes", rotulo: "Configurações" },
];

export function NavAdmin({ pendentes }: { pendentes: number }) {
  const atual = usePathname();
  return (
    <nav aria-label="Painel">
      {ITENS.map((i) => {
        const ativo = i.href === "/admin" ? atual === "/admin" : atual.startsWith(i.href);
        return (
          <div key={i.href}>
            {i.grupo && <div className="grupo">{i.grupo}</div>}
            {i.emBreve ? (
              <span title="Próxima fase">{i.rotulo} <small style={{ color: "inherit", fontSize: "0.72rem" }}>em breve</small></span>
            ) : (
              <Link href={i.href} aria-current={ativo ? "page" : undefined}>
                {i.rotulo}
                {i.href === "/admin/pedidos" && pendentes > 0 && <span className="contador">{pendentes}</span>}
              </Link>
            )}
          </div>
        );
      })}
    </nav>
  );
}
