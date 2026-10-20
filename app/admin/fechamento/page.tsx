import Link from "next/link";
import { exigirAdmin } from "@/lib/auth";
import { formatarBRL } from "@/lib/dinheiro";
import { formatarData, hojeSP } from "@/lib/datas";
import { calcularFechamento, intervaloMes, mesAnterior, nomeMes, type PedidoFech } from "@/lib/fechamento";
import { GraficoCusto, variacao, type PontoCusto } from "@/components/GraficoCusto";

export const metadata = { title: "Fechamento" };
export const dynamic = "force-dynamic";

const MOTIVOS: Record<string, string> = {
  derramou: "Derramou ou caiu", vencido: "Venceu", estragou: "Estragou", uso_indevido: "Alguém usou", quebra: "Embalagem quebrou", outro: "Outro",
};
const R = (c: number) => formatarBRL(Math.round(c));
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—");

export default async function Fechamento({ searchParams }: { searchParams: Promise<{ mes?: string; aba?: string }> }) {
  const sp = await searchParams;
  const mes = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : hojeSP().slice(0, 7);
  const aba = sp.aba === "custos" ? "custos" : "resultado";
  const meses = [0, 1, 2, 3, 4, 5].map((n) => mesAnterior(hojeSP().slice(0, 7), n));

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Fechamento</h1>
          <p className="suave" style={{ margin: 0 }}>Vendas contam no mês da entrega. Custos vêm dos lotes concluídos.</p>
        </div>
      </div>
      <nav className="abas">
        <Link href={`/admin/fechamento?mes=${mes}`} aria-current={aba === "resultado" ? "page" : undefined}>Resultado do mês</Link>
        <Link href={`/admin/fechamento?mes=${mes}&aba=custos`} aria-current={aba === "custos" ? "page" : undefined}>Custos dos insumos</Link>
      </nav>
      {aba === "resultado" ? (
        <>
          <div className="acoes" style={{ marginBottom: "1rem" }}>
            {meses.map((m) => (
              <Link key={m} className={`botao pequeno ${m === mes ? "" : "contorno"}`} href={`/admin/fechamento?mes=${m}`}>{nomeMes(m)}</Link>
            ))}
          </div>
          <Resultado mes={mes} />
        </>
      ) : <Custos />}
    </>
  );
}

async function Resultado({ mes }: { mes: string }) {
  const { supabase } = await exigirAdmin();
  const { inicio, fim } = intervaloMes(mes);
  const [{ data: pedidos }, { data: movs }, { data: lotes }, { data: compras }] = await Promise.all([
    supabase.from("pedidos")
      .select("tipo, total_centavos, taxa_entrega_centavos, recebido_centavos, pedido_itens(nome, quantidade, subtotal_centavos, lotes(status, unidades_boas, custo_materiais_centavos, custo_mao_obra_centavos))")
      .gte("entrega_em", inicio).lte("entrega_em", fim).neq("status_producao", "cancelado"),
    supabase.from("estoque_movimentos").select("tipo, categoria, valor_centavos").in("tipo", ["perda", "ajuste"]).gte("data", inicio).lte("data", fim),
    supabase.from("lotes").select("unidades_boas, perdas, custo_materiais_centavos, concluido_em").eq("status", "concluido").eq("tipo", "base")
      .gte("concluido_em", `${inicio}T03:00:00Z`).lte("concluido_em", `${fim}T23:59:59-03:00`),
    supabase.from("compras").select("total_centavos, custo_tempo_centavos").eq("cancelada", false).gte("data", inicio).lte("data", fim),
  ]);
  const ped: PedidoFech[] = ((pedidos ?? []) as any[]).map((p) => ({
    tipo: p.tipo, total_centavos: p.total_centavos, taxa_entrega_centavos: p.taxa_entrega_centavos ?? 0, recebido_centavos: p.recebido_centavos,
    itens: (p.pedido_itens ?? []).map((i: any) => ({ receita: i.nome, quantidade: i.quantidade, subtotal: i.subtotal_centavos, lote: i.lotes })),
  }));
  const tempo = (compras ?? []).reduce((s, c) => s + Number(c.custo_tempo_centavos ?? 0), 0);
  const totalCompras = (compras ?? []).reduce((s, c) => s + Number(c.total_centavos), 0);
  const f = calcularFechamento(ped, (movs ?? []) as any, ((lotes ?? []) as any[]).map((l) => ({ unidades_boas: l.unidades_boas ?? 0, perdas: l.perdas ?? 0, custo_materiais_centavos: Number(l.custo_materiais_centavos ?? 0) })), tempo);
  const basesComCusto = f.bases - f.basesSemCusto;

  const Linha = ({ rotulo, valor, sinal = "-", forte, sub }: { rotulo: string; valor: number; sinal?: "+" | "-" | ""; forte?: boolean; sub?: string }) => (
    <div className={`linha-total ${forte ? "forte" : ""}`}>
      <span>{rotulo}{sub && <div className="suave" style={{ fontSize: "0.8rem", fontWeight: 400 }}>{sub}</div>}</span>
      <span className="num" style={sinal === "" && valor < 0 ? { color: "var(--erro)" } : undefined}>
        {(sinal === "-" && valor) || (sinal === "" && valor < 0) ? "− " : sinal === "+" && valor ? "+ " : ""}{R(Math.abs(valor))}
      </span>
    </div>
  );

  if (!ped.length && !(movs ?? []).length && !(lotes ?? []).length && !(compras ?? []).length) {
    return <div className="cartao vazio">Nada registrado em {nomeMes(mes)} ainda.</div>;
  }

  return (
    <>
      <div className="cartoes">
        <div className="cartao"><div className="caixa-alta suave">Vendas</div><div className="indicador num">{R(f.receita)}</div><small>{f.pedidos} pedidos · {f.bases} bases</small></div>
        <div className="cartao"><div className="caixa-alta suave">CMV (materiais)</div><div className="indicador num">{R(f.cmv)}</div><small>{pct(f.cmv, f.receitaProdutos)} das vendas de bases</small></div>
        <div className="cartao"><div className="caixa-alta suave">Margem bruta</div><div className="indicador num">{R(f.margemBruta)}</div><small>{pct(f.margemBruta, f.receita)} das vendas</small></div>
        <div className="cartao"><div className="caixa-alta suave">Resultado</div><div className="indicador num" style={{ color: f.resultado < 0 ? "var(--erro)" : undefined }}>{f.resultado < 0 ? "− " : ""}{R(Math.abs(f.resultado))}</div><small>antes de despesas fixas</small></div>
      </div>

      {f.basesSemCusto > 0 && (
        <div className="aviso alerta">{f.basesSemCusto} {f.basesSemCusto === 1 ? "base vendida ainda não tem" : "bases vendidas ainda não têm"} custo apurado (o lote não foi concluído). O CMV deste mês sobe quando os lotes forem concluídos.</div>
      )}

      <div className="grade" style={{ gap: "1rem", alignItems: "start" }}>
        <div className="cartao">
          <h2>Demonstrativo de {nomeMes(mes)}</h2>
          <Linha rotulo="Vendas de bases" valor={f.receitaProdutos} sinal="" />
          {f.taxasEntrega > 0 && <Linha rotulo="Taxas de entrega" valor={f.taxasEntrega} sinal="+" />}
          <Linha rotulo="Receita" valor={f.receita} sinal="" forte />
          <Linha rotulo="CMV: ingredientes e embalagens" valor={f.cmv} sub={basesComCusto ? `${R(f.cmv / basesComCusto)} por base` : undefined} />
          <Linha rotulo="Margem bruta" valor={f.margemBruta} sinal="" forte />
          <Linha rotulo="Mão de obra (sua hora)" valor={f.maoDeObra} sub="tempo de produção dos lotes, pelo valor da hora" />
          <Linha rotulo="Brindes e marketing" valor={f.brindes.materiais + f.brindes.maoDeObra}
            sub={f.brindes.bases ? `${f.brindes.bases} bases em ${f.brindes.pedidos} ${f.brindes.pedidos === 1 ? "pedido" : "pedidos"}${f.brindes.semCusto ? `, ${f.brindes.semCusto} sem custo apurado` : ""}` : "nenhum brinde"} />
          <Linha rotulo="Perdas de estoque" valor={f.perdasEstoque}
            sub={Object.entries(f.perdasPorMotivo).map(([k, v]) => `${MOTIVOS[k] ?? k} ${R(v)}`).join(" · ") || "nenhuma"} />
          <Linha rotulo={f.inventario >= 0 ? "Inventário (sobrou)" : "Inventário (faltou)"} valor={f.inventario} sinal={f.inventario >= 0 ? "+" : "-"} />
          <Linha rotulo="Tempo gasto em compras" valor={f.tempoCompras} />
          <Linha rotulo="Resultado operacional" valor={f.resultado} sinal="" forte />
          <p className="ajuda" style={{ marginBottom: 0 }}>Ainda não entram aqui despesas fixas (gás, energia, embalagem de marca, taxas do Pix).</p>
        </div>

        <div>
          <div className="cartao">
            <h2>Por receita</h2>
            {!f.porReceita.length ? <div className="vazio">Sem vendas no mês.</div> : (
              <div className="tabela-rolagem">
                <table>
                  <thead><tr><th>Receita</th><th className="dir">Bases</th><th className="dir">Preço médio</th><th className="dir">Custo/base</th><th className="dir">Margem/base</th></tr></thead>
                  <tbody>
                    {f.porReceita.map((r) => {
                      const comCusto = r.bases - r.semCusto;
                      const custo = comCusto ? r.custo / comCusto : null;
                      const preco = r.receita_centavos / r.bases;
                      return (
                        <tr key={r.receita}>
                          <td>{r.receita}</td>
                          <td className="dir num">{r.bases}</td>
                          <td className="dir num">{R(preco)}</td>
                          <td className="dir num">{custo != null ? R(custo) : "—"}</td>
                          <td className="dir num">{custo != null ? `${R(preco - custo)} (${pct(preco - custo, preco)})` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="ajuda" style={{ marginBottom: 0 }}>Custo por base inclui ingredientes, embalagens e mão de obra.</p>
          </div>
          <div className="cartao">
            <h2>Caixa e produção</h2>
            <div className="linha-total"><span>Recebido dos pedidos do mês</span><span className="num">{R(f.recebido)}</span></div>
            <div className="linha-total"><span>A receber</span><span className="num">{R(f.aReceber)}</span></div>
            <div className="linha-total"><span>Compras no mês (vão para o estoque)</span><span className="num">{R(totalCompras)}</span></div>
            <div className="linha-total"><span>Bases perdidas na produção</span><span className="num">{f.basesPerdidas}{f.valorBasesPerdidas ? ` · ${R(f.valorBasesPerdidas)}` : ""}</span></div>
            <p className="ajuda" style={{ marginBottom: 0 }}>Base perdida já está dentro do custo por base boa (o lote divide o custo só pelas boas), então não soma de novo no resultado.</p>
          </div>
        </div>
      </div>
    </>
  );
}

async function Custos() {
  const { supabase } = await exigirAdmin();
  const [{ data: insumos }, { data: itens }, { data: padroes }, { data: lotes }] = await Promise.all([
    supabase.from("insumos").select("id, nome, unidade, categoria, controla_estoque, preco_ref_centavos").eq("ativo", true).order("categoria").order("nome"),
    supabase.from("compra_itens").select("insumo_id, quantidade_base, custo_final_centavos, marcas(nome), compras!inner(data, cancelada, fornecedores(nome))").eq("compras.cancelada", false),
    supabase.from("insumo_custos_padrao").select("insumo_id, custo_centavos, desde").order("desde"),
    supabase.from("lotes").select("numero, concluido_em, custo_por_unidade_centavos, receitas(nome)").eq("status", "concluido").eq("tipo", "base").order("concluido_em"),
  ]);
  const serie = (i: any): PontoCusto[] => {
    const f = i.unidade === "un" ? 1 : 1000;
    const compras = ((itens ?? []) as any[]).filter((c) => c.insumo_id === i.id)
      .map((c) => ({ data: c.compras.data, valor: (Number(c.custo_final_centavos) / Number(c.quantidade_base)) * f / 100, detalhe: [c.marcas?.nome, c.compras.fornecedores?.nome].filter(Boolean).join(" · ") }))
      .sort((a, b) => a.data.localeCompare(b.data));
    if (compras.length && i.controla_estoque) return compras;
    return (padroes ?? []).filter((p) => p.insumo_id === i.id).map((p) => ({ data: p.desde, valor: Number(p.custo_centavos) * f / 100, detalhe: "custo padrão" }));
  };
  const porReceita = new Map<string, PontoCusto[]>();
  for (const l of (lotes ?? []) as any[]) {
    const nome = l.receitas?.nome ?? "Receita";
    porReceita.set(nome, [...(porReceita.get(nome) ?? []), { data: l.concluido_em, valor: Number(l.custo_por_unidade_centavos) / 100, detalhe: `lote L-${String(l.numero).padStart(4, "0")}` }]);
  }
  const lista = (insumos ?? []).map((i) => ({ i, pontos: serie(i) }));
  const comDados = lista.filter((x) => x.pontos.length >= 2);

  return (
    <>
      {porReceita.size > 0 && (
        <div className="cartao">
          <h2>Custo por base boa, lote a lote</h2>
          <p className="suave" style={{ fontSize: "0.85rem", marginTop: 0 }}>Ingredientes, embalagens e mão de obra divididos pelas bases boas de cada lote.</p>
          <div className="grade" style={{ gap: "1rem" }}>
            {[...porReceita].map(([nome, pts]) => {
              const v = variacao(pts);
              return (
                <div key={nome}>
                  <div className="acoes" style={{ justifyContent: "space-between" }}>
                    <strong>{nome}</strong>
                    <span>{formatarBRL(Math.round(pts[pts.length - 1].valor * 100))}{v != null && <span className={v > 0 ? "variacao-sobe" : "variacao-desce"}> {v > 0 ? "▲" : "▼"} {Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>}</span>
                  </div>
                  <GraficoCusto pontos={pts} unidade="base" altura={150} largura={480} rotulo={`Custo por base de ${nome}`} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="cartao">
        <h2>Preço dos insumos</h2>
        <p className="suave" style={{ fontSize: "0.85rem", marginTop: 0 }}>Os gráficos aparecem quando o insumo tem pelo menos dois preços. Cada ponto é uma compra (com frete rateado). Insumos da casa mostram o histórico do custo padrão (que muda quando você lança uma compra deles ou edita o valor). Passe o mouse nos pontos.</p>
        <div className="tabela-rolagem">
          <table>
            <thead><tr><th>Insumo</th><th className="dir">Primeiro</th><th className="dir">Último</th><th className="dir">Variação</th><th>Última atualização</th></tr></thead>
            <tbody>
              {lista.map(({ i, pontos }) => {
                const un = i.unidade === "g" ? "kg" : i.unidade === "ml" ? "L" : "un";
                const v = variacao(pontos);
                return (
                  <tr key={i.id}>
                    <td><Link href={`/admin/insumos/${i.id}`}>{i.nome}</Link>{!i.controla_estoque && <> <span className="selo">da casa</span></>}</td>
                    <td className="dir num">{pontos.length ? `${formatarBRL(Math.round(pontos[0].valor * 100))}/${un}` : "—"}</td>
                    <td className="dir num">{pontos.length ? `${formatarBRL(Math.round(pontos[pontos.length - 1].valor * 100))}/${un}` : "—"}</td>
                    <td className="dir num">{v == null ? "—" : <span className={v > 0 ? "variacao-sobe" : v < 0 ? "variacao-desce" : ""}>{v > 0 ? "▲" : v < 0 ? "▼" : "="} {Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>}</td>
                    <td>{pontos.length ? formatarData(pontos[pontos.length - 1].data) : <span className="suave">sem compra nem custo padrão</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {comDados.length > 0 && (
        <div className="grade" style={{ gap: "1rem" }}>
          {comDados.map(({ i, pontos }) => {
            const un = i.unidade === "g" ? "kg" : i.unidade === "ml" ? "L" : "un";
            return (
              <div className="cartao" key={i.id}>
                <h3 style={{ margin: "0 0 0.3rem" }}>{i.nome} <span className="suave" style={{ fontWeight: 400, fontSize: "0.85rem" }}>R$/{un}</span></h3>
                <GraficoCusto pontos={pontos} unidade={un} altura={140} largura={420} rotulo={`Preço de ${i.nome}`} />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
