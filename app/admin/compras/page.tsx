import { Fragment } from "react";
import Link from "next/link";
import { exigirAdmin } from "@/lib/auth";
import { FormAcao } from "@/components/FormAcao";
import { formatarBRL } from "@/lib/dinheiro";
import { formatarData, formatarDataHora, hojeSP } from "@/lib/datas";
import { montarLista } from "@/lib/listaCompras";
import { descreverCombinacao, melhorCombinacao, opcoesSimples, type Embalagem } from "@/lib/embalagens";
import { registrarAjuste, salvarFornecedor } from "./actions";

export const metadata = { title: "Compras e estoque" };

type Aba = "compras" | "estoque" | "lista" | "fornecedores";

const POR: Record<string, [string, number]> = { g: ["kg", 1000], ml: ["L", 1000], un: ["un", 1] };
const qtd = (n: number, u: string) => `${Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${u}`;

export default async function Compras({ searchParams }: { searchParams: Promise<{ aba?: string; ver?: string; excluida?: string }> }) {
  const sp = await searchParams;
  const aba: Aba = (["estoque", "lista", "fornecedores"] as const).find((a) => a === sp.aba) ?? "compras";
  return (
    <>
      <div className="cabecalho">
        <h1>Compras e estoque</h1>
        <Link className="botao bordo" href="/admin/compras/nova">Nova compra</Link>
      </div>
      <nav className="abas">
        <Link href="/admin/compras" aria-current={aba === "compras" ? "page" : undefined}>Compras</Link>
        <Link href="/admin/compras?aba=estoque" aria-current={aba === "estoque" ? "page" : undefined}>Estoque</Link>
        <Link href="/admin/compras?aba=lista" aria-current={aba === "lista" ? "page" : undefined}>Lista de compras</Link>
        <Link href="/admin/compras?aba=fornecedores" aria-current={aba === "fornecedores" ? "page" : undefined}>Fornecedores</Link>
      </nav>
      {sp.excluida && <div className="aviso ok">Compra excluída e estoque estornado.</div>}
      {aba === "compras" && <ListaCompras ver={sp.ver} />}
      {aba === "estoque" && <Estoque />}
      {aba === "lista" && <ListaDeCompras />}
      {aba === "fornecedores" && <Fornecedores />}
    </>
  );
}

async function ListaCompras({ ver }: { ver?: string }) {
  const { supabase } = await exigirAdmin();
  let q = supabase
    .from("compras")
    .select("id, numero, data, canal, total_centavos, custo_tempo_centavos, minutos_trabalho, cancelada, fornecedores(nome), compra_itens(count)")
    .order("data", { ascending: false })
    .order("numero", { ascending: false })
    .limit(200);
  if (ver !== "todas") q = q.eq("cancelada", false);
  const { data: compras } = await q;
  const mes = hojeSP().slice(0, 7);
  const doMes = (compras ?? []).filter((c) => !c.cancelada && c.data.startsWith(mes));
  const nomeMes = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(new Date(`${mes}-15T12:00:00Z`));

  return (
    <>
      <div className="cartoes">
        <div className="cartao">
          <div className="caixa-alta suave">Compras em {nomeMes}</div>
          <div className="indicador num">{formatarBRL(doMes.reduce((s, c) => s + c.total_centavos, 0))}</div>
          <small>{doMes.length} {doMes.length === 1 ? "compra" : "compras"} · entrada de estoque, não é custo das vendas</small>
        </div>
        <div className="cartao">
          <div className="caixa-alta suave">Tempo de compras em {nomeMes}</div>
          <div className="indicador num">{formatarBRL(doMes.reduce((s, c) => s + c.custo_tempo_centavos, 0))}</div>
          <small>{doMes.reduce((s, c) => s + c.minutos_trabalho, 0)} minutos</small>
        </div>
      </div>
      <div className="cartao">
        <div className="acoes" style={{ justifyContent: "space-between", marginBottom: "0.5rem" }}>
          <h2 style={{ margin: 0 }}>{ver === "todas" ? "Todas as compras" : "Compras"}</h2>
          <Link className="suave" href={ver === "todas" ? "/admin/compras" : "/admin/compras?ver=todas"}>{ver === "todas" ? "Ocultar excluídas" : "Mostrar excluídas"}</Link>
        </div>
        {!compras?.length ? (
          <div className="vazio">
            <p>Nenhuma compra registrada.</p>
            <Link className="botao" href="/admin/compras/nova">Registrar a primeira</Link>
          </div>
        ) : (
          <div className="tabela-rolagem">
            <table>
              <thead><tr><th>Nº</th><th>Data</th><th>Fornecedor</th><th>Itens</th><th className="dir">Total</th><th className="dir">Tempo</th><th></th></tr></thead>
              <tbody>
                {compras.map((c: any) => (
                  <tr key={c.id} className="clicavel" style={c.cancelada ? { opacity: 0.55 } : undefined}>
                    <td><Link href={`/admin/compras/${c.id}`}><strong>C-{String(c.numero).padStart(4, "0")}</strong></Link></td>
                    <td className="num">{formatarData(c.data)}</td>
                    <td>{c.fornecedores?.nome}<div className="suave" style={{ fontSize: "0.8rem" }}>{c.canal}</div></td>
                    <td className="num">{c.compra_itens?.[0]?.count ?? 0}</td>
                    <td className="dir num">{formatarBRL(c.total_centavos)}</td>
                    <td className="dir num">{c.minutos_trabalho} min</td>
                    <td>{c.cancelada && <span className="selo erro">Excluída</span>}</td>
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

async function Estoque() {
  const { supabase } = await exigirAdmin();
  const [{ data: insumos }, { data: saldos }, { data: movs }] = await Promise.all([
    supabase.from("insumos").select("id, nome, unidade, categoria, preco_ref_centavos, ativo, marcas(id, nome, em_uso, ativo)").order("categoria").order("nome"),
    supabase.from("estoque_saldos").select("insumo_id, marca_id, quantidade, valor_centavos, marcas(nome)"),
    supabase.from("estoque_movimentos").select("id, tipo, quantidade, valor_centavos, data, motivo, criado_em, insumos(nome, unidade), marcas(nome), compras(numero)").order("criado_em", { ascending: false }).limit(40),
  ]);
  // Soma por insumo; o detalhe por marca aparece embaixo de cada um
  const s = new Map<string, { quantidade: number; valor_centavos: number }>();
  for (const x of saldos ?? []) {
    const a = s.get(x.insumo_id) ?? { quantidade: 0, valor_centavos: 0 };
    s.set(x.insumo_id, { quantidade: a.quantidade + Number(x.quantidade), valor_centavos: a.valor_centavos + Number(x.valor_centavos) });
  }
  const porMarca = (insumoId: string) => (saldos ?? []).filter((x: any) => x.insumo_id === insumoId && Number(x.quantidade) !== 0);
  const valorTotal = (saldos ?? []).reduce((t, x) => t + Number(x.valor_centavos), 0);
  const TIPO: Record<string, string> = { compra: "Compra", producao: "Produção", ajuste: "Ajuste", perda: "Perda", estorno: "Estorno" };

  return (
    <>
      <div className="cartoes">
        <div className="cartao">
          <div className="caixa-alta suave">Valor em estoque</div>
          <div className="indicador num">{formatarBRL(Math.round(valorTotal))}</div>
          <small>Pelo custo médio das compras</small>
        </div>
      </div>
      <div className="cartao">
        <h2>Saldo por insumo</h2>
        <div className="tabela-rolagem">
          <table>
            <thead><tr><th>Insumo</th><th className="dir">Em estoque</th><th className="dir">Custo médio</th><th className="dir">Valor</th></tr></thead>
            <tbody>
              {(insumos ?? []).filter((i) => i.ativo).map((i: any) => {
                const x = s.get(i.id);
                const q = Number(x?.quantidade ?? 0);
                const v = Number(x?.valor_centavos ?? 0);
                const [rot, f] = POR[i.unidade];
                const medio = q > 0 ? (v / q) * f : null;
                const ref = i.preco_ref_centavos != null ? Number(i.preco_ref_centavos) * f : null;
                const detalhe = porMarca(i.id);
                const mostrarDetalhe = detalhe.length > 1 || detalhe.some((x: any) => x.marca_id);
                return (
                  <Fragment key={i.id}>
                    <tr>
                      <td><Link href={`/admin/insumos/${i.id}`} style={{ color: "inherit" }}>{i.nome}</Link></td>
                      <td className="dir num" style={q < 0 ? { color: "var(--erro)" } : undefined}>{qtd(q, i.unidade)}</td>
                      <td className="dir num">
                        {medio != null ? `${formatarBRL(Math.round(medio))}/${rot}` : ref != null ? <span className="suave">{formatarBRL(Math.round(ref))}/{rot} (estimativa)</span> : <span className="suave">sem compra</span>}
                      </td>
                      <td className="dir num">{formatarBRL(Math.round(v))}</td>
                    </tr>
                    {mostrarDetalhe && detalhe.map((x: any) => {
                      const mq = Number(x.quantidade), mv = Number(x.valor_centavos);
                      return (
                        <tr key={`${i.id}-${x.marca_id ?? "sem"}`} className="suave" style={{ fontSize: "0.88rem" }}>
                          <td style={{ paddingLeft: "1.6rem" }}>{x.marcas?.nome ?? "sem marca"}</td>
                          <td className="dir num" style={mq < 0 ? { color: "var(--erro)" } : undefined}>{qtd(mq, i.unidade)}</td>
                          <td className="dir num">{mq > 0 ? `${formatarBRL(Math.round((mv / mq) * f))}/${rot}` : "—"}</td>
                          <td className="dir num">{formatarBRL(Math.round(mv))}</td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="cartao">
        <h2>Ajuste ou perda</h2>
        <p className="suave">Use para corrigir contagem (ajuste, positivo ou negativo) ou registrar perda. Fica valorizado pelo custo médio.</p>
        <FormAcao acao={registrarAjuste} botao="Registrar" limparAoSalvar>
          <div className="grade">
            <div className="campo">
              <label htmlFor="insumo_id">Insumo e marca</label>
              <select id="insumo_id" name="insumo_marca" required defaultValue="">
                <option value="" disabled>Escolha…</option>
                {(insumos ?? []).filter((i) => i.ativo).map((i: any) => (
                  <optgroup key={i.id} label={`${i.nome} (${i.unidade})`}>
                    {(i.marcas ?? []).filter((m: any) => m.ativo).map((m: any) => <option key={m.id} value={`${i.id}|${m.id}`}>{i.nome} · {m.nome}</option>)}
                    <option value={`${i.id}|`}>{i.nome} · sem marca</option>
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="tipo">Tipo</label>
              <select id="tipo" name="tipo" defaultValue="perda"><option value="perda">Perda (reduz)</option><option value="ajuste">Ajuste de contagem (+ ou −)</option></select>
            </div>
            <div className="campo">
              <label htmlFor="quantidade">Quantidade (na unidade do insumo)</label>
              <input id="quantidade" name="quantidade" inputMode="decimal" required placeholder="ex.: 250 ou −100" />
            </div>
            <div className="campo">
              <label htmlFor="data">Data</label>
              <input id="data" name="data" type="date" defaultValue={hojeSP()} />
            </div>
          </div>
          <div className="campo"><label htmlFor="motivo">Motivo</label><input id="motivo" name="motivo" required placeholder="Ex.: saco rasgado, contagem do mês" /></div>
        </FormAcao>
      </div>

      <div className="cartao">
        <h2>Últimos movimentos</h2>
        {!movs?.length ? <div className="vazio">Sem movimentos ainda.</div> : (
          <div className="tabela-rolagem">
            <table>
              <thead><tr><th>Quando</th><th>Tipo</th><th>Insumo</th><th className="dir">Quantidade</th><th className="dir">Valor</th><th>Origem / motivo</th></tr></thead>
              <tbody>
                {movs.map((m: any) => (
                  <tr key={m.id}>
                    <td className="num">{formatarData(m.data)}<div className="suave" style={{ fontSize: "0.78rem" }}>{formatarDataHora(m.criado_em)}</div></td>
                    <td>{TIPO[m.tipo] ?? m.tipo}</td>
                    <td>{m.insumos?.nome}{m.marcas?.nome && <span className="suave"> · {m.marcas.nome}</span>}</td>
                    <td className="dir num">{Number(m.quantidade) > 0 ? "+" : ""}{qtd(Number(m.quantidade), m.insumos?.unidade)}</td>
                    <td className="dir num">{formatarBRL(Math.round(Number(m.valor_centavos)))}</td>
                    <td>{m.compras ? `Compra C-${String(m.compras.numero).padStart(4, "0")}` : ""}{m.motivo ? `${m.compras ? " · " : ""}${m.motivo}` : ""}</td>
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

async function ListaDeCompras() {
  const { supabase } = await exigirAdmin();
  const [{ data: pedidos }, { data: cfg }, { data: insumos }, { data: saldos }, { data: embs }, { data: ultimas }] = await Promise.all([
    supabase.from("pedidos")
      .select("id, pedido_itens(quantidade, receita_versoes(peso_bolinha_g, massa_base_g, receita_versao_ingredientes(insumo_id, quantidade)))")
      .in("status_producao", ["confirmado", "em_producao"]),
    supabase.from("configuracoes").select("semola_g_por_base, saco_vacuo_por_base, etiqueta_por_base, molho_g_por_base, sacola_por_pedido").single(),
    supabase.from("insumos").select("id, nome, unidade, uso_auxiliar, entra_lista_compras, ativo").order("nome"),
    supabase.from("estoque_saldos").select("insumo_id, quantidade, valor_centavos"),
    supabase.from("insumo_embalagens").select("id, insumo_id, nome, quantidade_base, marca_id, marcas(nome, em_uso)").eq("ativo", true),
    supabase.from("compra_itens")
      .select("insumo_id, pacotes, conteudo, unidade_conteudo, quantidade_base, custo_final_centavos, compras!inner(data, cancelada, numero)")
      .eq("compras.cancelada", false)
      .order("compra_id", { ascending: false })
      .limit(500),
  ]);
  // Preço de um pacote: última compra com a mesma embalagem; sem ela, estimativa pelo custo médio
  const ultimaPorPacote = new Map<string, { preco: number; data: string }>();
  for (const it of (ultimas ?? []) as any[]) {
    const qbPacote = Number(it.quantidade_base) / Number(it.pacotes);
    const chave = `${it.insumo_id}|${Math.round(qbPacote * 1000)}`;
    const atual = ultimaPorPacote.get(chave);
    if (!atual || it.compras.data > atual.data) ultimaPorPacote.set(chave, { preco: Math.round(it.custo_final_centavos / Number(it.pacotes)), data: it.compras.data });
  }
  // Estoque e custo somando as marcas
  const totais = new Map<string, { q: number; v: number }>();
  for (const x of saldos ?? []) {
    const a = totais.get(x.insumo_id) ?? { q: 0, v: 0 };
    totais.set(x.insumo_id, { q: a.q + Number(x.quantidade), v: a.v + Number(x.valor_centavos) });
  }
  const medio = new Map([...totais].filter(([, t]) => t.q > 0).map(([k, t]) => [k, t.v / t.q]));
  // Embalagens da marca em uso (e as genéricas); sem marca em uso, todas
  const embalagensDe = (insumoId: string) => {
    const todas = (embs ?? []).filter((e: any) => e.insumo_id === insumoId);
    const daEmUso = todas.filter((e: any) => !e.marca_id || e.marcas?.em_uso);
    return (daEmUso.length ? daEmUso : todas).map((e: any): Embalagem & { estimado: boolean } => {
    const qb = Number(e.quantidade_base);
    const real = ultimaPorPacote.get(`${insumoId}|${Math.round(qb * 1000)}`);
    const m = medio.get(insumoId);
    return { id: e.id, nome: e.marcas?.nome ? `${e.marcas.nome} ${e.nome}` : e.nome, quantidade_base: qb, precoCentavos: real?.preco ?? (m != null ? Math.round(m * qb) : null), estimado: !real };
  });
  };
  const ped = (pedidos ?? []).map((p: any) => ({
    itens: (p.pedido_itens ?? []).map((i: any) => ({
      quantidade: i.quantidade,
      peso_bolinha_g: Number(i.receita_versoes.peso_bolinha_g),
      massa_base_g: Number(i.receita_versoes.massa_base_g),
      ingredientes: i.receita_versoes.receita_versao_ingredientes.map((g: any) => ({ insumo_id: g.insumo_id, quantidade: Number(g.quantidade) })),
    })),
  }));
  const aux = Object.fromEntries(Object.entries(cfg ?? {}).map(([k, v]) => [k, Number(v)])) as any;
  const { linhas, bases } = montarLista(ped, aux, insumos ?? [], Object.fromEntries([...totais].map(([k, t]) => [k, t.q])));
  const comprar = linhas.filter((l) => l.comprar > 0);

  return (
    <>
      <div className="aviso info">
        Considera {ped.length} {ped.length === 1 ? "pedido confirmado" : "pedidos confirmados"} ainda não produzidos ({bases} bases), pelas receitas gravadas em cada pedido,
        mais sêmola, sacos, etiquetas, molho e sacolas das configurações. Pagamentos ainda em conferência não entram.
      </div>
      <div className="cartao">
        <h2>Comprar</h2>
        {!comprar.length ? <div className="vazio">O estoque cobre os pedidos confirmados.</div> : (
          <div className="tabela-rolagem">
            <table>
              <thead><tr><th>Insumo</th><th className="dir">Precisa</th><th className="dir">Tem</th><th className="dir">Falta</th><th>Comprar</th></tr></thead>
              <tbody>
                {comprar.map((l) => {
                  const ems = embalagensDe(l.insumo.id);
                  const melhor = ems.length ? melhorCombinacao(l.comprar, ems) : null;
                  const alternativas = ems.length > 1 ? opcoesSimples(l.comprar, ems).filter((o) => !melhor || descreverCombinacao(o) !== descreverCombinacao(melhor)) : [];
                  const estimado = melhor?.itens.some((i) => (i.embalagem as any).estimado);
                  return (
                    <tr key={l.insumo.id}>
                      <td><strong>{l.insumo.nome}</strong></td>
                      <td className="dir num">{qtd(l.necessidade, l.insumo.unidade)}</td>
                      <td className="dir num">{qtd(l.estoque, l.insumo.unidade)}</td>
                      <td className="dir num">{qtd(l.comprar, l.insumo.unidade)}</td>
                      <td>
                        {melhor ? (
                          <>
                            <strong>{descreverCombinacao(melhor)}</strong>
                            <div className="suave" style={{ fontSize: "0.82rem" }}>
                              sobra {qtd(melhor.sobra, l.insumo.unidade)}
                              {melhor.custoCentavos != null && <> · {estimado ? "≈ " : ""}{formatarBRL(melhor.custoCentavos)}{estimado ? " (estimado)" : ""}</>}
                            </div>
                            {alternativas.slice(0, 2).map((o) => (
                              <div key={descreverCombinacao(o)} className="suave" style={{ fontSize: "0.78rem" }}>
                                ou {descreverCombinacao(o)} (sobra {qtd(o.sobra, l.insumo.unidade)}{o.custoCentavos != null ? `, ${formatarBRL(o.custoCentavos)}` : ""})
                              </div>
                            ))}
                          </>
                        ) : (
                          <span className="suave" style={{ fontSize: "0.85rem" }}>Cadastre as embalagens em Insumos para ver em pacotes</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {linhas.length > comprar.length && (
        <div className="cartao">
          <h2>Já coberto pelo estoque</h2>
          <div className="tabela-rolagem">
            <table>
              <thead><tr><th>Insumo</th><th className="dir">Precisa</th><th className="dir">Tem</th></tr></thead>
              <tbody>
                {linhas.filter((l) => l.comprar === 0).map((l) => (
                  <tr key={l.insumo.id}>
                    <td>{l.insumo.nome}{!l.insumo.entra_lista_compras && <span className="suave"> (não entra na lista)</span>}</td>
                    <td className="dir num">{qtd(l.necessidade, l.insumo.unidade)}</td>
                    <td className="dir num">{qtd(l.estoque, l.insumo.unidade)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="suave" style={{ fontSize: "0.85rem" }}>Quantidades teóricas, sem perdas. Quando os lotes de produção existirem (fase 3), a reserva de estoque dos lotes programados entra aqui.</p>
    </>
  );
}

async function Fornecedores() {
  const { supabase } = await exigirAdmin();
  const { data: fornecedores } = await supabase.from("fornecedores").select("*, compras(count)").order("nome");
  return (
    <>
      {(fornecedores ?? []).map((f: any) => (
        <div className="cartao" key={f.id}>
          <FormAcao acao={salvarFornecedor} botao="Salvar" classeBotao="pequeno">
            <input type="hidden" name="id" value={f.id} />
            <div className="grade">
              <div className="campo"><label>Nome</label><input name="nome" defaultValue={f.nome} required /></div>
              <div className="campo"><label>Contato</label><input name="contato" defaultValue={f.contato ?? ""} /></div>
              <div className="campo"><label>Observações</label><input name="observacoes" defaultValue={f.observacoes ?? ""} /></div>
            </div>
            <div className="acoes" style={{ marginBottom: "0.75rem" }}>
              <label className="check"><input type="checkbox" name="ativo" defaultChecked={f.ativo} /> Ativo</label>
              <span className="suave">{f.compras?.[0]?.count ?? 0} compras</span>
            </div>
          </FormAcao>
        </div>
      ))}
      <div className="cartao">
        <h2>Novo fornecedor</h2>
        <FormAcao acao={salvarFornecedor} botao="Cadastrar" limparAoSalvar>
          <div className="grade">
            <div className="campo"><label htmlFor="nf">Nome</label><input id="nf" name="nome" required /></div>
            <div className="campo"><label htmlFor="cf">Contato</label><input id="cf" name="contato" /></div>
            <div className="campo"><label htmlFor="of">Observações</label><input id="of" name="observacoes" /></div>
          </div>
        </FormAcao>
      </div>
    </>
  );
}
