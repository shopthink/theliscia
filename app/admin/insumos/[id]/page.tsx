import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirAdmin } from "@/lib/auth";
import { formatarData } from "@/lib/datas";
import { formatarBRL } from "@/lib/dinheiro";
import { precoPorEmbalagemBase } from "@/lib/marcas";
import { FormAcao } from "@/components/FormAcao";
import { Embalagens, FormNutricao } from "../Componentes";
import { salvarMarca, usarMarca } from "../actions";

export const metadata = { title: "Insumo" };
export const dynamic = "force-dynamic";

const fmtQtd = (q: number, un: string) =>
  un === "g" ? `${(q / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kg`
  : un === "ml" ? `${(q / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} L`
  : `${q.toLocaleString("pt-BR")} un`;

export default async function Insumo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await exigirAdmin();
  const [{ data: i }, { data: marcas }, { data: resumo }, { data: saldos }, { data: embalagens }] = await Promise.all([
    supabase.from("insumos").select("*").eq("id", id).maybeSingle(),
    supabase.from("marcas").select("*").eq("insumo_id", id).order("em_uso", { ascending: false }).order("ativo", { ascending: false }).order("nome"),
    supabase.from("marcas_resumo").select("*").eq("insumo_id", id),
    supabase.from("estoque_saldos").select("marca_id, quantidade, valor_centavos").eq("insumo_id", id),
    supabase.from("insumo_embalagens").select("id, nome, conteudo, marca_id").eq("insumo_id", id).eq("ativo", true),
  ]);
  if (!i) notFound();
  const res = new Map((resumo ?? []).map((r: any) => [r.id, r]));
  const semMarca = (saldos ?? []).find((s) => s.marca_id == null);
  const totalQtd = (saldos ?? []).reduce((s, x) => s + Number(x.quantidade), 0);
  const totalValor = (saldos ?? []).reduce((s, x) => s + Number(x.valor_centavos), 0);
  const ingrediente = i.categoria !== "embalagem";
  const lista = (marcas ?? []) as any[];
  const comparaveis = lista.filter((m) => m.ativo || Number(res.get(m.id)?.estoque ?? 0) !== 0);

  return (
    <>
      <div className="cabecalho">
        <div>
          <Link href="/admin/insumos" className="suave">← Insumos</Link>
          <h1>{i.nome}</h1>
          <p className="suave" style={{ margin: 0 }}>Controlado em {i.unidade} · {i.categoria}{!i.ativo && " · inativo"}</p>
        </div>
      </div>

      <div className="cartoes">
        <div className="cartao"><div className="caixa-alta suave">Estoque total</div><div className="indicador num">{fmtQtd(totalQtd, i.unidade)}</div>
          <small>{totalQtd > 0 ? `custo médio ${precoPorEmbalagemBase(totalValor / totalQtd, i.unidade)}` : "sem estoque"}</small></div>
        <div className="cartao"><div className="caixa-alta suave">Marca em uso</div><div className="indicador">{lista.find((m) => m.em_uso)?.nome ?? "—"}</div>
          <small>Os lotes novos começam com ela</small></div>
        {semMarca && Number(semMarca.quantidade) !== 0 && (
          <div className="cartao"><div className="caixa-alta suave">Sem marca</div><div className="indicador num">{fmtQtd(Number(semMarca.quantidade), i.unidade)}</div>
            <small>Compras antigas ou sem marca informada</small></div>
        )}
      </div>

      <div className="cartao">
        <h2>Comparativo de marcas</h2>
        {!comparaveis.length ? <div className="vazio">Nenhuma marca ainda. Cadastre aqui embaixo, ou digite a marca ao lançar uma compra.</div> : (
          <div className="tabela-rolagem">
            <table>
              <thead><tr>
                <th>Marca</th><th className="dir">Preço médio pago</th><th>Última compra</th><th className="dir">Compras</th>
                <th className="dir">Estoque</th>{ingrediente && <th className="dir">Lotes</th>}{ingrediente && <th className="dir">Perda</th>}<th></th>
              </tr></thead>
              <tbody>
                {comparaveis.map((m) => {
                  const r = res.get(m.id) ?? {};
                  const feitas = Number(r.bases_boas ?? 0) + Number(r.perdas ?? 0);
                  const perda = feitas > 0 ? (Number(r.perdas ?? 0) / feitas) * 100 : null;
                  return (
                    <tr key={m.id}>
                      <td><strong>{m.nome}</strong> {m.em_uso && <span className="selo ok">em uso</span>}{!m.ativo && <span className="selo">inativa</span>}
                        {m.notas && <div className="suave" style={{ fontSize: "0.82rem", maxWidth: 280 }}>{m.notas}</div>}</td>
                      <td className="dir num">{precoPorEmbalagemBase(r.custo_medio_centavos, i.unidade)}</td>
                      <td>{r.ultima_compra_em ? <>{precoPorEmbalagemBase(r.ultimo_custo_centavos, i.unidade)}<div className="suave" style={{ fontSize: "0.82rem" }}>{formatarData(r.ultima_compra_em)}{r.ultimo_fornecedor ? ` · ${r.ultimo_fornecedor}` : ""}</div></> : "—"}</td>
                      <td className="dir num">{r.compras ?? 0}</td>
                      <td className="dir num">{fmtQtd(Number(r.estoque ?? 0), i.unidade)}</td>
                      {ingrediente && <td className="dir num">{r.lotes ?? 0}</td>}
                      {ingrediente && <td className="dir num">{perda == null ? "—" : `${perda.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}</td>}
                      <td className="dir">
                        {!m.em_uso && m.ativo && (
                          <FormAcao acao={usarMarca} botao="Usar esta" classeBotao="contorno pequeno">
                            <input type="hidden" name="id" value={m.id} /><input type="hidden" name="insumo_id" value={i.id} />
                          </FormAcao>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {ingrediente && <p className="ajuda" style={{ marginBottom: 0 }}>Perda = bases perdidas sobre bases feitas nos lotes concluídos que usaram a marca. Preço médio já inclui frete e taxas rateados.</p>}
        {totalValor < 0 && <p className="aviso alerta">O estoque está com valor negativo: confira o inventário.</p>}
      </div>

      {lista.map((m) => (
        <details className="cartao" key={m.id}>
          <summary><strong>{m.nome}</strong> {m.em_uso && <span className="selo ok">em uso</span>} <span className="suave">· dados, tabela nutricional e embalagens</span></summary>
          <div style={{ marginTop: "0.9rem" }}>
            <FormAcao acao={salvarMarca} botao="Salvar marca" classeBotao="pequeno">
              <input type="hidden" name="id" value={m.id} /><input type="hidden" name="versao" value={m.versao} /><input type="hidden" name="insumo_id" value={i.id} />
              <CamposMarca m={m} ingrediente={ingrediente} />
              <label className="check" style={{ marginBottom: "0.75rem" }}><input type="checkbox" name="ativo" defaultChecked={m.ativo} /> Ativa</label>
            </FormAcao>
            {ingrediente && <div style={{ borderTop: "1px solid var(--creme-2)", marginTop: "0.9rem", paddingTop: "0.9rem" }}>
              <FormNutricao insumoId={i.id} unidade={i.unidade} marcaId={m.id} valores={m} titulo={`Tabela nutricional da ${m.nome}`} />
            </div>}
            <div style={{ borderTop: "1px solid var(--creme-2)", marginTop: "0.9rem", paddingTop: "0.9rem" }}>
              <Embalagens insumoId={i.id} unidade={i.unidade} marcaId={m.id} lista={(embalagens ?? []).filter((e) => e.marca_id === m.id)} />
            </div>
          </div>
        </details>
      ))}

      <div className="cartao">
        <h2>Nova marca</h2>
        <FormAcao acao={salvarMarca} botao="Cadastrar marca" classeBotao="bordo" limparAoSalvar>
          <input type="hidden" name="insumo_id" value={i.id} />
          <CamposMarca m={{}} ingrediente={ingrediente} />
          <label className="check" style={{ marginBottom: "0.75rem" }}><input type="checkbox" name="em_uso" defaultChecked={!lista.some((x) => x.em_uso)} /> Usar nos próximos lotes (em uso)</label>
        </FormAcao>
      </div>

      <div className="cartao">
        <h2>Sem marca (genérico)</h2>
        {ingrediente && <div style={{ marginBottom: "0.9rem" }}><FormNutricao insumoId={i.id} unidade={i.unidade} valores={i} titulo="Tabela nutricional genérica" /></div>}
        <Embalagens insumoId={i.id} unidade={i.unidade} lista={(embalagens ?? []).filter((e) => e.marca_id == null)} />
      </div>
    </>
  );
}

function CamposMarca({ m, ingrediente }: { m: any; ingrediente: boolean }) {
  const s = m.id ?? "nova";
  return (
    <>
      <div className="grade">
        <div className="campo"><label htmlFor={`mn-${s}`}>Nome da marca</label><input id={`mn-${s}`} name="nome" defaultValue={m.nome ?? ""} required maxLength={80} placeholder="Ex.: Caputo Pizzeria" /></div>
        {ingrediente && (
          <div className="campo"><label htmlFor={`mr-${s}`}>Como aparece na lista de ingredientes</label><input id={`mr-${s}`} name="nome_rotulo" defaultValue={m.nome_rotulo ?? ""} maxLength={200} placeholder="Ex.: farinha de trigo tipo 00" />
            <span className="ajuda">Copie do pacote. Vai para a etiqueta.</span></div>
        )}
      </div>
      <div className="campo"><label htmlFor={`mo-${s}`}>Notas de qualidade</label><textarea id={`mo-${s}`} name="notas" defaultValue={m.notas ?? ""} maxLength={2000} placeholder="Ex.: absorve mais água, massa mais elástica, fermenta mais rápido" /></div>
    </>
  );
}
