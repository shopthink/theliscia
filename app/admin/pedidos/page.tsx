import Link from "next/link";
import { exigirAdmin } from "@/lib/auth";
import { formatarBRL } from "@/lib/dinheiro";
import { campanhaAberta, formatarData, formatarDataHora } from "@/lib/datas";
import { formatarTelefone } from "@/lib/telefone";
import { urlDoSite } from "@/lib/env";
import { Copiar } from "@/components/Copiar";
import { SeloPagamento, SeloProducao, SeloSolicitacao, statusVisivel } from "@/components/Selos";

export const metadata = { title: "Pedidos" };

type Aba = "confirmados" | "conferencia" | "campanha";

export default async function Pedidos({ searchParams }: { searchParams: Promise<{ aba?: string; ver?: string; recusado?: string }> }) {
  const sp = await searchParams;
  const aba: Aba = sp.aba === "conferencia" || sp.aba === "campanha" ? sp.aba : "confirmados";
  const { supabase } = await exigirAdmin();
  const { count: pendentes } = await supabase.from("solicitacoes").select("id", { count: "exact", head: true }).eq("status", "em_conferencia");

  return (
    <>
      <div className="cabecalho">
        <h1>Pedidos</h1>
        <Link className="botao bordo" href="/admin/pedidos/novo">Novo pedido manual</Link>
      </div>
      <nav className="abas">
        <Link href="/admin/pedidos" aria-current={aba === "confirmados" ? "page" : undefined}>Pedidos confirmados</Link>
        <Link href="/admin/pedidos?aba=conferencia" aria-current={aba === "conferencia" ? "page" : undefined}>
          Pagamentos aguardando conferência{pendentes ? <span className="contador">{pendentes}</span> : null}
        </Link>
        <Link href="/admin/pedidos?aba=campanha" aria-current={aba === "campanha" ? "page" : undefined}>Campanha</Link>
      </nav>
      {sp.recusado && <div className="aviso ok">Solicitação recusada e registrada. Ela não vai para a produção.</div>}
      {aba === "confirmados" && <Confirmados ver={sp.ver} />}
      {aba === "conferencia" && <Conferencia />}
      {aba === "campanha" && <CampanhaAtual />}
    </>
  );
}

async function Confirmados({ ver }: { ver?: string }) {
  const { supabase } = await exigirAdmin();
  let q = supabase
    .from("pedidos")
    .select("id, numero, cliente_nome, cliente_telefone, origem, modalidade, entrega_em, total_centavos, recebido_centavos, status_pagamento, status_producao, pedido_itens(nome, quantidade)")
    .order("entrega_em", { ascending: true })
    .order("numero", { ascending: true })
    .limit(300);
  if (ver !== "todos") q = q.not("status_producao", "in", "(entregue,cancelado)");
  const { data: pedidos } = await q;

  // O que precisa ser produzido: pedidos confirmados ou em produção
  const aProduzir = new Map<string, number>();
  for (const p of pedidos ?? []) {
    if (!["confirmado", "em_producao"].includes(p.status_producao)) continue;
    for (const i of p.pedido_itens as any[]) aProduzir.set(i.nome, (aProduzir.get(i.nome) ?? 0) + i.quantidade);
  }
  const saldo = (pedidos ?? []).filter((p) => p.status_producao !== "cancelado").reduce((s, p) => s + (p.total_centavos - p.recebido_centavos), 0);

  return (
    <>
      <div className="cartoes">
        <div className="cartao">
          <div className="caixa-alta suave">A produzir</div>
          {aProduzir.size === 0 ? <div className="suave">Nada pendente.</div> : [...aProduzir].map(([nome, q]) => (
            <div key={nome} className="linha-total"><span>{nome}</span><strong className="num">{q}</strong></div>
          ))}
        </div>
        <div className="cartao">
          <div className="caixa-alta suave">Saldo a receber {ver === "todos" ? "(todos)" : "(em aberto)"}</div>
          <div className="indicador num">{formatarBRL(saldo)}</div>
        </div>
      </div>
      <div className="cartao">
        <div className="acoes" style={{ justifyContent: "space-between", marginBottom: "0.5rem" }}>
          <h2 style={{ margin: 0 }}>{ver === "todos" ? "Todos os pedidos" : "Em aberto"}</h2>
          <Link href={ver === "todos" ? "/admin/pedidos" : "/admin/pedidos?ver=todos"} className="suave">
            {ver === "todos" ? "Ver só em aberto" : "Incluir entregues e cancelados"}
          </Link>
        </div>
        {!pedidos?.length ? (
          <div className="vazio">Nenhum pedido {ver === "todos" ? "" : "em aberto"}. Pedidos aprovados pelo Pix e pedidos manuais aparecem aqui.</div>
        ) : (
          <div className="tabela-rolagem">
            <table>
              <thead>
                <tr><th>Nº</th><th>Cliente</th><th>Entrega</th><th>Itens</th><th className="dir">Total</th><th className="dir">Saldo</th><th>Pagamento</th><th>Produção</th></tr>
              </thead>
              <tbody>
                {pedidos.map((p: any) => (
                  <tr key={p.id} className="clicavel">
                    <td><Link href={`/admin/pedidos/${p.id}`}><strong>#{String(p.numero).padStart(4, "0")}</strong></Link></td>
                    <td>
                      <Link href={`/admin/pedidos/${p.id}`} style={{ color: "inherit", textDecoration: "none" }}>{p.cliente_nome}</Link>
                      <div className="suave" style={{ fontSize: "0.82rem" }}>{formatarTelefone(p.cliente_telefone)} · {p.origem === "link" ? "link" : "manual"}</div>
                    </td>
                    <td className="num">{formatarData(p.entrega_em)}<div className="suave" style={{ fontSize: "0.82rem" }}>{p.modalidade}</div></td>
                    <td>{(p.pedido_itens as any[]).map((i) => `${i.quantidade}× ${i.nome}`).join(", ")}</td>
                    <td className="dir num">{formatarBRL(p.total_centavos)}</td>
                    <td className="dir num">{formatarBRL(p.total_centavos - p.recebido_centavos)}</td>
                    <td><SeloPagamento valor={p.status_pagamento} /></td>
                    <td><SeloProducao valor={p.status_producao} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

async function Conferencia() {
  const { supabase } = await exigirAdmin();
  const { data: lista } = await supabase
    .from("solicitacoes")
    .select("id, numero, cliente_nome, cliente_telefone, campanha_nome, entrega_em, total_centavos, sinal_centavos, total_bases, status, comprovante_ate, criado_em, comprovantes(count)")
    .in("status", ["em_conferencia", "aguardando_pagamento"])
    .order("criado_em", { ascending: true })
    .limit(300);
  const emConf = (lista ?? []).filter((s) => s.status === "em_conferencia");
  const aguardando = (lista ?? []).filter((s) => s.status === "aguardando_pagamento");

  const Tabela = ({ itens, vazio }: { itens: any[]; vazio: string }) =>
    !itens.length ? <div className="vazio">{vazio}</div> : (
      <div className="tabela-rolagem">
        <table>
          <thead><tr><th>Solicitação</th><th>Cliente</th><th>Recebida em</th><th>Bases</th><th className="dir">Pagar agora</th><th className="dir">Total</th><th>Status</th></tr></thead>
          <tbody>
            {itens.map((s) => (
              <tr key={s.id} className="clicavel">
                <td><Link href={`/admin/conferencia/${s.id}`}><strong>S-{String(s.numero).padStart(4, "0")}</strong></Link><div className="suave" style={{ fontSize: "0.82rem" }}>{s.campanha_nome}</div></td>
                <td>{s.cliente_nome}<div className="suave" style={{ fontSize: "0.82rem" }}>{formatarTelefone(s.cliente_telefone)}</div></td>
                <td className="num">{formatarDataHora(s.criado_em)}</td>
                <td className="num">{s.total_bases}</td>
                <td className="dir num">{formatarBRL(s.sinal_centavos)}</td>
                <td className="dir num">{formatarBRL(s.total_centavos)}</td>
                <td><SeloSolicitacao valor={statusVisivel(s)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <>
      <div className="aviso info">
        Comprovante enviado não é pagamento confirmado. Abra cada solicitação, confira o crédito no extrato do banco e só então aprove.
      </div>
      <div className="cartao">
        <h2>Com comprovante, aguardando sua conferência</h2>
        <Tabela itens={emConf} vazio="Nenhum comprovante para conferir." />
      </div>
      <div className="cartao">
        <h2>Pedidos iniciados, sem comprovante</h2>
        <p className="suave">O cliente gerou o pedido e ainda não enviou o comprovante. Se o Pix chegou por outro canal, você pode aprovar mesmo assim.</p>
        <Tabela itens={aguardando} vazio="Nenhum." />
      </div>
    </>
  );
}

async function CampanhaAtual() {
  const { supabase } = await exigirAdmin();
  const { data: c } = await supabase.from("campanhas").select("id, nome, ativa, abre_em, fecha_em, entrega_em, percentual_sinal, pedido_minimo, pix_favorecido, campanha_produtos(nome, preco_centavos, ativo)").eq("ativa", true).maybeSingle();
  const link = `${urlDoSite()}/pedido`;
  if (!c) {
    return (
      <div className="cartao vazio">
        <p>Nenhuma campanha ativa. O link público está mostrando “pedidos fechados”.</p>
        <Link className="botao" href="/admin/campanhas">Ir para campanhas</Link>
      </div>
    );
  }
  return (
    <div className="cartao">
      <div className="acoes" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>{c.nome}</h2>
        {campanhaAberta(c) ? <span className="selo ok">Vendendo agora</span> : <span className="selo alerta">Ativa, fora da janela</span>}
      </div>
      <p style={{ marginTop: "0.5rem" }}>
        Pedidos de {formatarData(c.abre_em)} a {formatarData(c.fecha_em)} · entrega em <strong>{formatarData(c.entrega_em)}</strong> ·
        mínimo de {c.pedido_minimo} bases · {c.percentual_sinal === 100 ? "100% no Pix" : "50% de sinal"} · Pix para {c.pix_favorecido}
      </p>
      {(c.campanha_produtos as any[]).filter((p) => p.ativo).map((p) => (
        <div key={p.nome} className="linha-total"><span>{p.nome}</span><span className="num">{formatarBRL(p.preco_centavos)}</span></div>
      ))}
      <hr />
      <div className="acoes">
        <code className="pix-chave" style={{ flex: "1 1 240px" }}>{link}</code>
        <Copiar texto={link} rotulo="Copiar link" />
        <a className="botao contorno pequeno" href="/pedido" target="_blank" rel="noopener">Abrir</a>
        <Link className="botao pequeno" href={`/admin/campanhas/${c.id}`}>Editar campanha</Link>
      </div>
    </div>
  );
}
