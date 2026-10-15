import Link from "next/link";
import { exigirAdmin } from "@/lib/auth";
import { urlDoSite } from "@/lib/env";
import { formatarBRL } from "@/lib/dinheiro";
import { formatarData, hojeSP } from "@/lib/datas";
import { formatarTelefone, linkWhatsApp } from "@/lib/telefone";
import { unidade } from "@/lib/condominios";
import { mensagemSegmento, SEGMENTOS } from "@/lib/crm";
import { consultarClientes, type FiltrosClientes } from "@/lib/crmConsulta";
import { FormAcao } from "@/components/FormAcao";
import { CamposCliente } from "./CamposCliente";
import { criarLead } from "./actions";

export const metadata = { title: "Clientes" };
export const dynamic = "force-dynamic";

const ABAS: [string, string][] = [["", "Todos"], ["lead", "Leads"], ["novo", "Novos"], ["recorrente", "Recorrentes"], ["sumido", "Sumidos"], ["fa", "Fãs"]];

export default async function Clientes({ searchParams }: { searchParams: Promise<FiltrosClientes & { novo?: string }> }) {
  const f = await searchParams;
  const { supabase } = await exigirAdmin();
  const [{ data: lista }, { data: todos }, { data: condominios }, { data: campanha }, { data: cfg }] = await Promise.all([
    consultarClientes(supabase, f),
    supabase.from("clientes_resumo").select("segmento, fa, aceita_novidades").limit(10000),
    supabase.from("condominios").select("id, nome, slug").order("nome"),
    supabase.from("campanhas").select("entrega_em, fecha_em").eq("ativa", true).maybeSingle(),
    supabase.from("configuracoes").select("nome_comercial, dias_sumido").maybeSingle(),
  ]);
  const conta = (s: string) => (todos ?? []).filter((c) => (s === "" ? true : s === "fa" ? c.fa : c.segmento === s)).length;
  const comAceite = (todos ?? []).filter((c) => c.aceita_novidades).length;
  const site = urlDoSite();
  const marca = cfg?.nome_comercial ?? "The Liscia Pizzas";
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ seg: f.seg, q: f.q, novidades: f.novidades, cond: f.cond, etiqueta: f.etiqueta, ...extra })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Clientes</h1>
          <p className="suave" style={{ margin: 0 }}>{todos?.length ?? 0} contatos · {comAceite} {comAceite === 1 ? "aceita" : "aceitam"} receber novidades · sumido após {cfg?.dias_sumido ?? 45} dias sem pedir</p>
        </div>
        <div className="acoes">
          <a className="botao contorno" href={`/admin/clientes/exportar${qs({})}`}>Exportar planilha</a>
          <Link className="botao bordo" href={`/admin/clientes${qs({ novo: "1" })}#novo`}>Novo lead</Link>
        </div>
      </div>

      <nav className="abas">
        {ABAS.map(([v, r]) => (
          <Link key={v} href={`/admin/clientes${qs({ seg: v || undefined })}`} aria-current={(f.seg ?? "") === v ? "page" : undefined} title={SEGMENTOS[v]?.ajuda}>
            {r} <span className="contador">{conta(v)}</span>
          </Link>
        ))}
      </nav>

      <form className="cartao filtros-clientes" method="get">
        {f.seg && <input type="hidden" name="seg" value={f.seg} />}
        <div className="campo"><label htmlFor="q">Buscar</label><input id="q" name="q" defaultValue={f.q ?? ""} placeholder="Nome ou WhatsApp" /></div>
        <div className="campo">
          <label htmlFor="cond">Condomínio</label>
          <select id="cond" name="cond" defaultValue={f.cond ?? ""}>
            <option value="">Todos</option>
            {(condominios ?? []).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <div className="campo"><label htmlFor="etiqueta">Etiqueta</label><input id="etiqueta" name="etiqueta" defaultValue={f.etiqueta ?? ""} placeholder="Ex.: embaixador" /></div>
        <label className="check"><input type="checkbox" name="novidades" value="1" defaultChecked={f.novidades === "1"} /> Só quem aceita novidades</label>
        <div className="acoes"><button type="submit" className="pequeno">Filtrar</button><Link href="/admin/clientes" className="suave">Limpar</Link></div>
      </form>

      <div className="cartao">
        {!lista?.length ? <div className="vazio">Nenhum cliente com esses filtros.</div> : (
          <div className="tabela-rolagem">
            <table>
              <thead><tr><th>Cliente</th><th>Segmento</th><th>Condomínio</th><th className="dir">Pedidos</th><th className="dir">Bases</th><th className="dir">Total</th><th>Último pedido</th><th></th></tr></thead>
              <tbody>
                {lista.map((c: any) => {
                  const seg = SEGMENTOS[c.segmento];
                  const link = `${site}/pedido${c.condominio_slug ? `?c=${c.condominio_slug}` : ""}`;
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/admin/clientes/${c.id}`}><strong>{c.nome}</strong></Link>{c.fa && <span title="Fã: entre quem mais compra"> ★</span>}
                        <div className="suave" style={{ fontSize: "0.82rem" }}>{formatarTelefone(c.telefone)}{c.aceita_novidades ? " · aceita novidades" : ""}</div>
                        {c.etiquetas?.length > 0 && <div style={{ fontSize: "0.78rem" }}>{c.etiquetas.map((e: string) => <span key={e} className="etiqueta-crm">{e}</span>)}</div>}
                      </td>
                      <td><span className={`selo ${seg?.classe ?? ""}`}>{seg?.rotulo ?? c.segmento}</span>{c.nao_pagas > 0 && <div className="suave" style={{ fontSize: "0.78rem" }}>{c.nao_pagas} não {c.nao_pagas === 1 ? "paga" : "pagas"}</div>}</td>
                      <td>{c.condominio_nome ?? "—"}{c.condominio_nome && (c.bloco || c.apto) && <div className="suave" style={{ fontSize: "0.82rem" }}>{unidade(c.bloco, c.apto)}</div>}</td>
                      <td className="dir num">{c.pedidos}</td>
                      <td className="dir num">{c.bases}</td>
                      <td className="dir num">{formatarBRL(Number(c.total_centavos))}</td>
                      <td className="num">{c.ultimo_pedido_em ? formatarData(hojeSP(new Date(c.ultimo_pedido_em))) : "—"}</td>
                      <td className="dir">
                        <a className="botao contorno pequeno" target="_blank" rel="noopener"
                          href={linkWhatsApp(c.telefone, mensagemSegmento(c.segmento, c.nome, marca, campanha, link))}>WhatsApp</a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {(lista?.length ?? 0) >= 1000 && <p className="suave">Mostrando os 1000 mais recentes. Use a busca ou os filtros.</p>}
      </div>

      <details className="cartao" id="novo" open={f.novo === "1"}>
        <summary><h2 style={{ display: "inline" }}>Cadastrar lead</h2> <span className="suave">· interessado que chegou pelo WhatsApp, Instagram, indicação…</span></summary>
        <div style={{ marginTop: "1rem" }}>
          <FormAcao acao={criarLead} botao="Cadastrar" classeBotao="bordo">
            <CamposCliente c={{}} condominios={condominios ?? []} novo />
          </FormAcao>
        </div>
      </details>
    </>
  );
}
