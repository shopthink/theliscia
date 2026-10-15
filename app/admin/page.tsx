import Link from "next/link";
import { exigirAdmin } from "@/lib/auth";
import { formatarBRL } from "@/lib/dinheiro";
import { campanhaAberta, formatarData, hojeSP } from "@/lib/datas";
import { SeloPagamento, SeloProducao } from "@/components/Selos";
import { codigoLote, ETAPAS_TRABALHO } from "@/lib/producao";
import { formatarMinutos } from "@/lib/datas";
import { Relogio } from "./producao/Relogio";

export const metadata = { title: "Início" };

function somarDias(iso: string, dias: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export default async function Inicio() {
  const { supabase } = await exigirAdmin();
  const hoje = hojeSP();
  const mesIni = `${hoje.slice(0, 7)}-01`;
  const proxMes = somarDias(`${hoje.slice(0, 7)}-28`, 5).slice(0, 7) + "-01";

  const [{ count: pendentes }, { data: abertos }, { data: entreguesMes }, { data: campanha }, { data: aberta }, { data: sessoesMes }, { count: lotesAbertos }] = await Promise.all([
    supabase.from("solicitacoes").select("id", { count: "exact", head: true }).eq("status", "em_conferencia"),
    supabase.from("pedidos").select("id, numero, cliente_nome, entrega_em, total_centavos, recebido_centavos, status_pagamento, status_producao, pedido_itens(nome, quantidade)")
      .not("status_producao", "in", "(entregue,cancelado)").order("entrega_em").limit(200),
    supabase.from("pedidos").select("total_centavos, recebido_centavos, pedido_itens(quantidade)")
      .eq("status_producao", "entregue").gte("entrega_em", mesIni).lt("entrega_em", proxMes),
    supabase.from("campanhas").select("id, nome, ativa, abre_em, fecha_em, entrega_em").eq("ativa", true).maybeSingle(),
    supabase.from("lote_sessoes").select("etapa, inicio, lote_id, lotes(numero)").is("fim", null).maybeSingle(),
    supabase.from("lote_sessoes").select("inicio, fim").gte("inicio", `${mesIni}T03:00:00Z`).lt("inicio", `${proxMes}T03:00:00Z`).not("fim", "is", null),
    supabase.from("lotes").select("id", { count: "exact", head: true }).in("status", ["planejado", "em_producao"]),
  ]);
  const minutosMes = (sessoesMes ?? []).reduce((t, x) => t + (Date.parse(x.fim!) - Date.parse(x.inicio)) / 60000, 0);

  const vendasMes = (entreguesMes ?? []).reduce((s, p) => s + p.total_centavos, 0);
  const basesMes = (entreguesMes ?? []).reduce((s, p: any) => s + p.pedido_itens.reduce((a: number, i: any) => a + i.quantidade, 0), 0);
  const saldo = (abertos ?? []).reduce((s, p) => s + (p.total_centavos - p.recebido_centavos), 0)
    + (entreguesMes ?? []).reduce((s, p) => s + (p.total_centavos - p.recebido_centavos), 0);
  const aProduzir = new Map<string, number>();
  for (const p of abertos ?? []) if (["confirmado", "em_producao"].includes(p.status_producao))
    for (const i of p.pedido_itens as any[]) aProduzir.set(i.nome, (aProduzir.get(i.nome) ?? 0) + i.quantidade);
  const proximas = (abertos ?? []).filter((p) => p.entrega_em <= somarDias(hoje, 7));
  const nomeMes = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${mesIni}T12:00:00Z`));

  return (
    <>
      <div className="cabecalho"><h1>Início</h1><span className="suave">Hoje, {formatarData(hoje)}</span></div>

      {(pendentes ?? 0) > 0 && (
        <div className="aviso alerta acoes" style={{ justifyContent: "space-between" }}>
          <span><strong>{pendentes}</strong> {pendentes === 1 ? "pagamento aguarda" : "pagamentos aguardam"} sua conferência.</span>
          <Link className="botao bordo pequeno" href="/admin/pedidos?aba=conferencia">Conferir</Link>
        </div>
      )}

      {aberta && (
        <Link href={`/admin/producao/${aberta.lote_id}`} className="aviso alerta acoes" style={{ justifyContent: "space-between", textDecoration: "none" }}>
          <span><strong>▶ {ETAPAS_TRABALHO[aberta.etapa]}</strong> no lote {codigoLote((aberta as any).lotes.numero)}</span>
          <strong className="num"><Relogio desde={aberta.inicio} /></strong>
        </Link>
      )}

      <div className="cartoes">
        <div className="cartao">
          <div className="caixa-alta suave">Vendas entregues em {nomeMes}</div>
          <div className="indicador num">{formatarBRL(vendasMes)}</div>
          <small>{basesMes} bases · reconhecidas pela data de entrega</small>
        </div>
        <div className="cartao">
          <div className="caixa-alta suave">Saldo a receber</div>
          <div className="indicador num">{formatarBRL(saldo)}</div>
          <small>Pedidos em aberto e entregues no mês</small>
        </div>
        <div className="cartao">
          <div className="caixa-alta suave">A produzir</div>
          {aProduzir.size === 0 ? <div className="suave">Nada pendente.</div> : [...aProduzir].map(([n, q]) => (
            <div key={n} className="linha-total"><span>{n}</span><strong className="num">{q}</strong></div>
          ))}
        </div>
        <div className="cartao">
          <div className="caixa-alta suave">Produção em {nomeMes}</div>
          <div className="indicador num">{formatarMinutos(minutosMes)}</div>
          <small>de trabalho ativo · <Link href="/admin/producao">{lotesAbertos ?? 0} {lotesAbertos === 1 ? "lote aberto" : "lotes abertos"}</Link></small>
        </div>
        <div className="cartao">
          <div className="caixa-alta suave">Campanha</div>
          {campanha ? (
            <>
              <strong>{campanha.nome}</strong>
              <div>{campanhaAberta(campanha) ? <span className="selo ok">Vendendo</span> : <span className="selo alerta">Fora da janela</span>}</div>
              <small>Até {formatarData(campanha.fecha_em)} · entrega {formatarData(campanha.entrega_em)}</small>
            </>
          ) : (
            <><div className="suave">Nenhuma ativa.</div><Link href="/admin/campanhas">Configurar</Link></>
          )}
        </div>
      </div>

      <div className="cartao">
        <h2>Entregas nos próximos 7 dias</h2>
        {!proximas.length ? <div className="vazio">Nenhuma entrega prevista.</div> : (
          <div className="tabela-rolagem">
            <table>
              <thead><tr><th>Nº</th><th>Cliente</th><th>Entrega</th><th>Itens</th><th className="dir">Saldo</th><th>Pagamento</th><th>Produção</th></tr></thead>
              <tbody>
                {proximas.map((p: any) => (
                  <tr key={p.id}>
                    <td><Link href={`/admin/pedidos/${p.id}`}>#{String(p.numero).padStart(4, "0")}</Link></td>
                    <td>{p.cliente_nome}</td>
                    <td className="num">{formatarData(p.entrega_em)}</td>
                    <td>{p.pedido_itens.map((i: any) => `${i.quantidade}× ${i.nome}`).join(", ")}</td>
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
      <p className="suave" style={{ fontSize: "0.88rem" }}>
        Resultado do mês com CMV e fechamento entra na fase 4.
      </p>
    </>
  );
}
