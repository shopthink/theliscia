import Link from "next/link";
import { exigirAdmin } from "@/lib/auth";
import { formatarBRL } from "@/lib/dinheiro";
import { formatarData, formatarMinutos } from "@/lib/datas";
import { codigoLote, ESPERAS, ETAPAS_TRABALHO, STATUS_LOTE } from "@/lib/producao";
import { Relogio, Regressiva } from "./Relogio";

export const metadata = { title: "Produção" };

export default async function Producao() {
  const { supabase } = await exigirAdmin();
  const [{ data: pendentes }, { data: lotes }, { data: receitas }, { data: aberta }] = await Promise.all([
    supabase.from("pedido_itens")
      .select("id, quantidade, receita_id, pedidos!inner(id, numero, cliente_nome, entrega_em, status_producao)")
      .is("lote_id", null)
      .in("pedidos.status_producao", ["confirmado", "em_producao"]),
    supabase.from("lotes")
      .select("id, numero, tipo, status, data_planejada, bases_pedidos, bases_extras, quantidade_planejada, unidades_boas, quantidade_produzida, minutos_ativos, custo_por_unidade_centavos, receitas(nome, produz:insumos!receitas_produz_insumo_id_fkey(unidade)), lote_sessoes(etapa, inicio, fim), lote_esperas(tipo, inicio, fim, alvo_min)")
      .neq("status", "cancelado")
      .order("criado_em", { ascending: false })
      .limit(60),
    supabase.from("receitas").select("id, nome, tipo, versao_atual_id").eq("ativa", true).order("nome"),
    supabase.from("lote_sessoes").select("id, etapa, inicio, lote_id, lotes(numero)").is("fim", null).maybeSingle(),
  ]);

  const porReceita = new Map<string, { bases: number; pedidos: Set<string>; entregaMin: string }>();
  for (const it of (pendentes ?? []) as any[]) {
    const g = porReceita.get(it.receita_id) ?? { bases: 0, pedidos: new Set<string>(), entregaMin: "9999" };
    g.bases += it.quantidade;
    g.pedidos.add(it.pedidos.id);
    if (it.pedidos.entrega_em < g.entregaMin) g.entregaMin = it.pedidos.entrega_em;
    porReceita.set(it.receita_id, g);
  }
  const ativos = (lotes ?? []).filter((l: any) => l.status !== "concluido");
  const concluidos = (lotes ?? []).filter((l: any) => l.status === "concluido").slice(0, 15);
  const preparos = (receitas ?? []).filter((r) => r.tipo === "preparo" && r.versao_atual_id);

  return (
    <>
      <div className="cabecalho">
        <h1>Produção</h1>
        <div className="acoes">
          {preparos.map((r) => <Link key={r.id} className="botao contorno" href={`/admin/producao/novo?receita=${r.id}`}>Novo lote de {r.nome.toLowerCase()}</Link>)}
        </div>
      </div>

      {aberta && (
        <Link href={`/admin/producao/${aberta.lote_id}`} className="aviso alerta acoes" style={{ justifyContent: "space-between", textDecoration: "none" }}>
          <span><strong>▶ {ETAPAS_TRABALHO[aberta.etapa]}</strong> no lote {codigoLote((aberta as any).lotes.numero)}</span>
          <strong className="num"><Relogio desde={aberta.inicio} /></strong>
        </Link>
      )}

      <div className="cartao">
        <h2>A produzir</h2>
        <p className="suave">Bases de pedidos confirmados que ainda não estão em nenhum lote.</p>
        {!porReceita.size ? <div className="vazio">Nada na fila.</div> : (
          <div className="tabela-rolagem">
            <table>
              <thead><tr><th>Receita</th><th className="dir">Bases</th><th className="dir">Pedidos</th><th>Entrega mais próxima</th><th></th></tr></thead>
              <tbody>
                {[...porReceita].map(([rid, g]) => (
                  <tr key={rid}>
                    <td><strong>{receitas?.find((r) => r.id === rid)?.nome}</strong></td>
                    <td className="dir num">{g.bases}</td>
                    <td className="dir num">{g.pedidos.size}</td>
                    <td className="num">{formatarData(g.entregaMin)}</td>
                    <td className="dir"><Link className="botao bordo pequeno" href={`/admin/producao/novo?receita=${rid}`}>Planejar lote</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ marginTop: "0.75rem" }}>
          {(receitas ?? []).filter((r) => r.tipo === "base" && !porReceita.has(r.id) && r.versao_atual_id).map((r) => (
            <Link key={r.id} className="botao contorno pequeno" style={{ marginRight: 8 }} href={`/admin/producao/novo?receita=${r.id}`}>Lote de {r.nome} para estoque</Link>
          ))}
        </div>
      </div>

      <div className="cartao">
        <h2>Lotes em andamento</h2>
        {!ativos.length ? <div className="vazio">Nenhum lote aberto.</div> : (
          <div className="tabela-rolagem">
            <table>
              <thead><tr><th>Lote</th><th>Receita</th><th className="dir">Quantidade</th><th>Agora</th><th className="dir">Trabalho</th><th>Status</th></tr></thead>
              <tbody>
                {ativos.map((l: any) => {
                  const sessaoAberta = l.lote_sessoes.find((s: any) => !s.fim);
                  const espera = l.lote_esperas.find((e: any) => !e.fim);
                  const min = l.lote_sessoes.reduce((t: number, s: any) => t + (s.fim ? (Date.parse(s.fim) - Date.parse(s.inicio)) / 60000 : 0), 0);
                  const [rot, cls] = STATUS_LOTE[l.status];
                  return (
                    <tr key={l.id} className="clicavel">
                      <td><Link href={`/admin/producao/${l.id}`}><strong>{codigoLote(l.numero)}</strong></Link><div className="suave" style={{ fontSize: "0.8rem" }}>{formatarData(l.data_planejada)}</div></td>
                      <td>{l.receitas?.nome}</td>
                      <td className="dir num">{l.tipo === "base" ? `${l.bases_pedidos + l.bases_extras} bases` : `${Number(l.quantidade_planejada).toLocaleString("pt-BR")} ${l.receitas?.produz?.unidade ?? ""}`}</td>
                      <td>
                        {sessaoAberta ? <span>▶ {ETAPAS_TRABALHO[sessaoAberta.etapa]} · <Relogio desde={sessaoAberta.inicio} /></span>
                          : espera ? <span>⏳ {ESPERAS[espera.tipo]} · <Regressiva desde={espera.inicio} alvoMin={espera.alvo_min} /></span>
                          : <span className="suave">parado</span>}
                      </td>
                      <td className="dir num">{formatarMinutos(min)}</td>
                      <td><span className={`selo ${cls}`}>{rot}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="cartao">
        <h2>Concluídos recentes</h2>
        {!concluidos.length ? <div className="vazio">Nenhum lote concluído ainda.</div> : (
          <div className="tabela-rolagem">
            <table>
              <thead><tr><th>Lote</th><th>Receita</th><th className="dir">Produziu</th><th className="dir">Trabalho</th><th className="dir">Custo por unidade</th></tr></thead>
              <tbody>
                {concluidos.map((l: any) => (
                  <tr key={l.id} className="clicavel">
                    <td><Link href={`/admin/producao/${l.id}`}><strong>{codigoLote(l.numero)}</strong></Link></td>
                    <td>{l.receitas?.nome}</td>
                    <td className="dir num">{l.tipo === "base" ? `${l.unidades_boas} bases` : `${Number(l.quantidade_produzida).toLocaleString("pt-BR")} ${l.receitas?.produz?.unidade ?? ""}`}</td>
                    <td className="dir num">{formatarMinutos(Number(l.minutos_ativos))}</td>
                    <td className="dir num">
                      {l.tipo === "base" ? formatarBRL(Math.round(Number(l.custo_por_unidade_centavos))) + "/base"
                        : l.receitas?.produz?.unidade === "un"
                          ? `${formatarBRL(Math.round(Number(l.custo_por_unidade_centavos)))}/un`
                          : `${formatarBRL(Math.round(Number(l.custo_por_unidade_centavos) * 1000))}/${l.receitas?.produz?.unidade === "ml" ? "L" : "kg"}`}
                    </td>
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
