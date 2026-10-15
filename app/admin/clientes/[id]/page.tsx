import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirAdmin } from "@/lib/auth";
import { urlDoSite } from "@/lib/env";
import { formatarBRL } from "@/lib/dinheiro";
import { formatarData, formatarDataHora, hojeSP } from "@/lib/datas";
import { formatarTelefone, linkWhatsApp } from "@/lib/telefone";
import { localEntrega } from "@/lib/condominios";
import { mensagemSegmento, ORIGENS, SEGMENTOS } from "@/lib/crm";
import { FormAcao } from "@/components/FormAcao";
import { SeloPagamento, SeloProducao, SeloSolicitacao, statusVisivel } from "@/components/Selos";
import { CamposCliente } from "../CamposCliente";
import { salvarCliente } from "../actions";

export const metadata = { title: "Cliente" };
export const dynamic = "force-dynamic";

export default async function Cliente({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ criado?: string }> }) {
  const { id } = await params;
  const { criado } = await searchParams;
  const { supabase } = await exigirAdmin();
  const [{ data: r }, { data: c }, { data: pedidos }, { data: tentativas }, { data: condominios }, { data: campanha }, { data: cfg }] = await Promise.all([
    supabase.from("clientes_resumo").select("*").eq("id", id).maybeSingle(),
    supabase.from("clientes").select("*").eq("id", id).maybeSingle(),
    supabase.from("pedidos").select("id, numero, criado_em, entrega_em, modalidade, endereco, condominio_nome, bloco, apto, total_centavos, status_pagamento, status_producao, pedido_itens(nome, quantidade)").eq("cliente_id", id).order("criado_em", { ascending: false }),
    supabase.from("solicitacoes").select("id, numero, criado_em, total_centavos, total_bases, status, comprovante_ate").eq("cliente_id", id).neq("status", "aprovada").order("criado_em", { ascending: false }),
    supabase.from("condominios").select("id, nome").order("nome"),
    supabase.from("campanhas").select("entrega_em, fecha_em").eq("ativa", true).maybeSingle(),
    supabase.from("configuracoes").select("nome_comercial").maybeSingle(),
  ]);
  if (!r || !c) notFound();
  const seg = SEGMENTOS[r.segmento];
  const link = `${urlDoSite()}/pedido${r.condominio_slug ? `?c=${r.condominio_slug}` : ""}`;
  const msg = mensagemSegmento(r.segmento, r.nome, cfg?.nome_comercial ?? "The Liscia Pizzas", campanha, link);
  const ticket = r.pedidos ? Math.round(Number(r.total_centavos) / r.pedidos) : 0;
  const preferidas = new Map<string, number>();
  for (const p of (pedidos ?? []) as any[]) if (p.status_producao !== "cancelado") for (const i of p.pedido_itens) preferidas.set(i.nome, (preferidas.get(i.nome) ?? 0) + i.quantidade);

  return (
    <>
      <div className="cabecalho">
        <div>
          <Link href="/admin/clientes" className="suave">← Clientes</Link>
          <h1>{r.nome} <span className={`selo ${seg?.classe ?? ""}`}>{seg?.rotulo}</span>{r.fa && <span className="selo escuro" style={{ marginLeft: 6 }}>★ Fã</span>}</h1>
          <p className="suave" style={{ margin: 0 }}>
            {formatarTelefone(r.telefone)} · {ORIGENS[r.origem ?? ""] ?? r.origem ?? "—"} · desde {formatarData(hojeSP(new Date(r.criado_em)))}
            {r.condominio_nome && <> · {r.condominio_nome}{(r.bloco || r.apto) && ` (${[r.bloco && `Bl ${r.bloco}`, r.apto && `Ap ${r.apto}`].filter(Boolean).join(" · ")})`}</>}
          </p>
        </div>
        <a className="botao" href={linkWhatsApp(r.telefone, msg)} target="_blank" rel="noopener">Mandar WhatsApp</a>
      </div>
      {criado && <div className="aviso ok">Lead cadastrado.</div>}
      {!r.aceita_novidades && <div className="aviso info">Este contato não aceitou receber novidades. Fale só sobre pedidos dele, ou peça o aceite.</div>}

      <div className="cartoes">
        <div className="cartao"><div className="caixa-alta suave">Pedidos</div><div className="indicador num">{r.pedidos}</div><small>{r.bases} bases</small></div>
        <div className="cartao"><div className="caixa-alta suave">Total gasto</div><div className="indicador num">{formatarBRL(Number(r.total_centavos))}</div><small>ticket médio {formatarBRL(ticket)}</small></div>
        <div className="cartao"><div className="caixa-alta suave">Último pedido</div><div className="indicador num">{r.ultimo_pedido_em ? formatarData(hojeSP(new Date(r.ultimo_pedido_em))) : "—"}</div><small>{r.pedidos ? `primeiro em ${formatarData(hojeSP(new Date(r.primeiro_pedido_em)))}` : "ainda não comprou"}</small></div>
        <div className="cartao"><div className="caixa-alta suave">Preferidas</div>
          {preferidas.size ? [...preferidas].sort((a, b) => b[1] - a[1]).map(([n, q]) => <div key={n} className="linha-total" style={{ border: 0, margin: 0, padding: 0 }}><span>{n}</span><strong className="num">{q}</strong></div>) : <div className="suave">—</div>}
        </div>
      </div>

      <div className="cartao">
        <h2>Mensagem sugerida ({seg?.rotulo.toLowerCase()})</h2>
        <div className="pix-chave" style={{ fontFamily: "inherit" }}>{msg}</div>
        <p className="ajuda" style={{ marginBottom: 0 }}>O botão “Mandar WhatsApp” abre a conversa já com este texto. Você pode editar antes de enviar.</p>
      </div>

      <div className="grade" style={{ gap: "1rem", alignItems: "start" }}>
        <div>
          <div className="cartao">
            <h2>Pedidos</h2>
            {!pedidos?.length ? <div className="vazio">Nenhum pedido.</div> : (pedidos as any[]).map((p) => (
              <div key={p.id} className="linha-total" style={{ alignItems: "flex-start" }}>
                <span>
                  <Link href={`/admin/pedidos/${p.id}`}><strong>#{String(p.numero).padStart(4, "0")}</strong></Link> · entrega {formatarData(p.entrega_em)}
                  <div className="suave" style={{ fontSize: "0.85rem" }}>{p.pedido_itens.map((i: any) => `${i.quantidade}× ${i.nome}`).join(", ")} · {localEntrega(p)}</div>
                  <div className="acoes" style={{ marginTop: 4 }}><SeloPagamento valor={p.status_pagamento} /><SeloProducao valor={p.status_producao} /></div>
                </span>
                <span className="num">{formatarBRL(p.total_centavos)}</span>
              </div>
            ))}
          </div>
          {(tentativas?.length ?? 0) > 0 && (
            <div className="cartao">
              <h2>Pedidos iniciados e não pagos</h2>
              {(tentativas as any[]).map((s) => (
                <div key={s.id} className="linha-total">
                  <span><Link href={`/admin/conferencia/${s.id}`}>S-{String(s.numero).padStart(4, "0")}</Link> · {formatarDataHora(s.criado_em)} · {s.total_bases} bases <SeloSolicitacao valor={statusVisivel(s)} /></span>
                  <span className="num">{formatarBRL(s.total_centavos)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="cartao">
          <h2>Dados e anotações</h2>
          <FormAcao acao={salvarCliente} botao="Salvar">
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="versao" value={c.versao} />
            <CamposCliente c={c} condominios={condominios ?? []} />
          </FormAcao>
          {c.aceite_em && <p className="suave" style={{ fontSize: "0.85rem", marginBottom: 0 }}>Aceite registrado em {formatarDataHora(c.aceite_em)} ({c.aceite_origem === "manual" ? "marcado por você" : "no formulário de pedido"}).</p>}
        </div>
      </div>
    </>
  );
}
