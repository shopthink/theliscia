import Link from "next/link";
import { exigirAdmin } from "@/lib/auth";
import { formatarBRL } from "@/lib/dinheiro";
import { campanhaAberta, formatarData, formatarDataHora } from "@/lib/datas";
import { formatarTelefone } from "@/lib/telefone";
import { urlDoSite } from "@/lib/env";
import { Copiar } from "@/components/Copiar";
import { compararUnidade, FORMA_ENTREGA, localEntrega, unidade } from "@/lib/condominios";
import { linkWhatsApp } from "@/lib/telefone";
import { FormAcao } from "@/components/FormAcao";
import { BotaoImprimir } from "@/components/BotaoImprimir";
import { mudarStatusProducao } from "./actions";
import { SeloPagamento, SeloProducao, SeloSolicitacao, statusVisivel } from "@/components/Selos";

export const metadata = { title: "Pedidos" };

type Aba = "confirmados" | "conferencia" | "campanha" | "entregas";

export default async function Pedidos({ searchParams }: { searchParams: Promise<{ aba?: string; ver?: string; recusado?: string; data?: string }> }) {
  const sp = await searchParams;
  const aba: Aba = sp.aba === "conferencia" || sp.aba === "campanha" || sp.aba === "entregas" ? sp.aba : "confirmados";
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
        <Link href="/admin/pedidos?aba=entregas" aria-current={aba === "entregas" ? "page" : undefined}>Entregas</Link>
        <Link href="/admin/pedidos?aba=campanha" aria-current={aba === "campanha" ? "page" : undefined}>Campanha</Link>
      </nav>
      {sp.recusado && <div className="aviso ok">Solicitação recusada e registrada. Ela não vai para a produção.</div>}
      {aba === "confirmados" && <Confirmados ver={sp.ver} />}
      {aba === "conferencia" && <Conferencia />}
      {aba === "campanha" && <CampanhaAtual />}
      {aba === "entregas" && <Entregas data={sp.data} />}
    </>
  );
}

async function Confirmados({ ver }: { ver?: string }) {
  const { supabase } = await exigirAdmin();
  let q = supabase
    .from("pedidos")
    .select("id, numero, cliente_nome, cliente_telefone, origem, modalidade, endereco, condominio_nome, bloco, apto, entrega_em, total_centavos, recebido_centavos, status_pagamento, status_producao, pedido_itens(nome, quantidade)")
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
                    <td className="num">{formatarData(p.entrega_em)}<div className="suave" style={{ fontSize: "0.82rem", maxWidth: 220 }}>{p.condominio_nome ? localEntrega(p) : p.modalidade === "retirada" ? "retirada" : "endereço"}</div></td>
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

/** Lista de entrega do dia: agrupada por condomínio (ordenada por bloco/apto), depois endereços avulsos e retiradas. */
async function Entregas({ data }: { data?: string }) {
  const { supabase } = await exigirAdmin();
  const { data: datas } = await supabase
    .from("pedidos").select("entrega_em").not("status_producao", "in", "(entregue,cancelado)").order("entrega_em").limit(500);
  const abertas = [...new Set((datas ?? []).map((d) => d.entrega_em))];
  const dia = data && /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : abertas[0];
  if (!dia) return <div className="cartao vazio">Nenhuma entrega pendente.</div>;

  const [{ data: pedidos }, { data: condos }, { data: cfg }] = await Promise.all([
    supabase.from("pedidos")
      .select("id, numero, versao, cliente_nome, cliente_telefone, modalidade, endereco, condominio_id, condominio_nome, bloco, apto, observacoes, total_centavos, recebido_centavos, status_producao, pedido_itens(nome, quantidade)")
      .eq("entrega_em", dia).neq("status_producao", "cancelado").order("numero"),
    supabase.from("condominios").select("id, nome, endereco, forma_entrega, janela_entrega, notas_internas"),
    supabase.from("configuracoes").select("nome_comercial").maybeSingle(),
  ]);
  const lista = (pedidos ?? []) as any[];
  const marca = cfg?.nome_comercial ?? "The Liscia";
  const grupos = new Map<string, any[]>();
  for (const p of lista.filter((x) => x.condominio_id)) grupos.set(p.condominio_id, [...(grupos.get(p.condominio_id) ?? []), p]);
  const avulsos = lista.filter((x) => !x.condominio_id && x.modalidade === "entrega");
  const retiradas = lista.filter((x) => x.modalidade === "retirada");
  const bases = (p: any) => p.pedido_itens.reduce((s: number, i: any) => s + i.quantidade, 0);
  const totalBases = lista.reduce((s, p) => s + bases(p), 0);
  const aReceber = lista.reduce((s, p) => s + p.total_centavos - p.recebido_centavos, 0);
  const pendentes = lista.filter((p) => p.status_producao !== "entregue").length;

  const Linhas = ({ itens, msg }: { itens: any[]; msg: (p: any) => string }) => (
    <div className="tabela-rolagem">
      <table>
        <thead><tr><th>Unidade / endereço</th><th>Pedido</th><th>Cliente</th><th>Itens</th><th className="dir">A receber</th><th className="oculto-impressao"></th></tr></thead>
        <tbody>
          {itens.map((p) => {
            const saldo = p.total_centavos - p.recebido_centavos;
            return (
              <tr key={p.id} style={p.status_producao === "entregue" ? { opacity: 0.55 } : undefined}>
                <td><strong>{p.condominio_id ? unidade(p.bloco, p.apto) : p.modalidade === "retirada" ? "Retirada" : p.endereco}</strong>{p.observacoes && <div className="suave" style={{ fontSize: "0.82rem" }}>Obs.: {p.observacoes}</div>}</td>
                <td><Link href={`/admin/pedidos/${p.id}`}>#{String(p.numero).padStart(4, "0")}</Link></td>
                <td>{p.cliente_nome}<div className="suave" style={{ fontSize: "0.82rem" }}><a href={linkWhatsApp(p.cliente_telefone, msg(p))} target="_blank" rel="noopener">{formatarTelefone(p.cliente_telefone)}</a></div></td>
                <td>{p.pedido_itens.map((i: any) => `${i.quantidade}× ${i.nome}`).join(", ")}</td>
                <td className="dir num">{saldo > 0 ? <strong style={{ color: "var(--bordo)" }}>{formatarBRL(saldo)}</strong> : "pago"}</td>
                <td className="oculto-impressao dir">
                  {p.status_producao === "entregue" ? <SeloProducao valor="entregue" /> : (
                    <FormAcao acao={mudarStatusProducao} botao="Entregue" classeBotao="contorno pequeno">
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="versao" value={p.versao} />
                      <input type="hidden" name="status" value="entregue" />
                    </FormAcao>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="romaneio">
      <div className="acoes oculto-impressao" style={{ justifyContent: "space-between", marginBottom: "1rem" }}>
        <div className="acoes">
          {abertas.map((d) => (
            <Link key={d} className={`botao pequeno ${d === dia ? "" : "contorno"}`} href={`/admin/pedidos?aba=entregas&data=${d}`}>{formatarData(d)}</Link>
          ))}
        </div>
        <BotaoImprimir rotulo="Imprimir lista" />
      </div>
      <div className="cartoes">
        <div className="cartao"><div className="caixa-alta suave">Entrega de {formatarData(dia)}</div><div className="indicador num">{lista.length} pedidos</div><small>{pendentes} a entregar</small></div>
        <div className="cartao"><div className="caixa-alta suave">Bases e sacolas</div><div className="indicador num">{totalBases}</div><small>{lista.length} {lista.length === 1 ? "sacola" : "sacolas"}</small></div>
        <div className="cartao"><div className="caixa-alta suave">A receber na entrega</div><div className="indicador num">{formatarBRL(aReceber)}</div></div>
      </div>

      {[...grupos].map(([cid, itens]) => {
        const c = (condos ?? []).find((x) => x.id === cid);
        const nome = c?.nome ?? itens[0].condominio_nome;
        const ordenados = [...itens].sort(compararUnidade);
        return (
          <div key={cid} className="cartao grupo-entrega">
            <h3>{nome} <span className="suave" style={{ fontWeight: 400, fontSize: "0.9rem" }}>· {itens.length} {itens.length === 1 ? "pedido" : "pedidos"}, {itens.reduce((s, p) => s + bases(p), 0)} bases</span></h3>
            <p className="suave" style={{ margin: "0 0 0.5rem", fontSize: "0.9rem" }}>
              {c?.endereco}{c && <> · {FORMA_ENTREGA[c.forma_entrega]}</>}{c?.janela_entrega && <>, {c.janela_entrega}</>}
              {c?.notas_internas && <><br />Nota: {c.notas_internas}</>}
            </p>
            <Linhas itens={ordenados} msg={(p) => c?.forma_entrega === "porta"
              ? `Oi, ${p.cliente_nome.split(" ")[0]}! Aqui é da ${marca}. Estou no ${nome} e já subo para entregar o seu pedido #${String(p.numero).padStart(4, "0")} (${localEntrega(p)}).`
              : `Oi, ${p.cliente_nome.split(" ")[0]}! Aqui é da ${marca}. Cheguei na portaria do ${nome} com o seu pedido #${String(p.numero).padStart(4, "0")}. Pode descer?`} />
          </div>
        );
      })}
      {avulsos.length > 0 && (
        <div className="cartao grupo-entrega">
          <h3>Outros endereços <span className="suave" style={{ fontWeight: 400, fontSize: "0.9rem" }}>· {avulsos.length} {avulsos.length === 1 ? "pedido" : "pedidos"}</span></h3>
          <Linhas itens={avulsos} msg={(p) => `Oi, ${p.cliente_nome.split(" ")[0]}! Aqui é da ${marca}. Estou a caminho com o seu pedido #${String(p.numero).padStart(4, "0")}.`} />
        </div>
      )}
      {retiradas.length > 0 && (
        <div className="cartao grupo-entrega">
          <h3>Retiradas <span className="suave" style={{ fontWeight: 400, fontSize: "0.9rem" }}>· {retiradas.length}</span></h3>
          <Linhas itens={retiradas} msg={(p) => `Oi, ${p.cliente_nome.split(" ")[0]}! Aqui é da ${marca}. Seu pedido #${String(p.numero).padStart(4, "0")} está pronto para retirar.`} />
        </div>
      )}
    </div>
  );
}
