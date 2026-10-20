"use client";
import { useMemo, useState, useTransition } from "react";
import { formatarData } from "@/lib/datas";
import { criarLote } from "../actions";

interface Item { id: string; quantidade: number; pedidos: { numero: number; cliente_nome: string; entrega_em: string } }
interface Ingrediente { insumo_id: string; quantidade: number; insumos: { nome: string; unidade: string } }
interface Receita {
  id: string; nome: string; tipo: "base" | "preparo";
  produz: { nome: string; unidade: string } | null;
  versao: { id: string; numero: number; peso_bolinha_g: number | null; massa_base_g: number; rendimento: number | null; receita_versao_ingredientes: Ingrediente[] };
}
interface Auxiliar { id: string; nome: string; unidade: string; uso_auxiliar: string }

const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

export function FormNovoLote({ receita: r, itens, aux, auxiliares, estoque, casa = [], hoje }: {
  receita: Receita; itens: Item[]; aux: Record<string, number>; auxiliares: Auxiliar[]; estoque: Record<string, number>; casa?: string[]; hoje: string;
}) {
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set(itens.map((i) => i.id)));
  const [extras, setExtras] = useState("0");
  const [peso, setPeso] = useState(String(r.versao.peso_bolinha_g ?? 180));
  const [data, setData] = useState(hoje);
  const [qtdPreparo, setQtdPreparo] = useState(String(r.versao.rendimento ?? ""));
  const [obs, setObs] = useState("");

  const basesPedidos = itens.filter((i) => marcados.has(i.id)).reduce((s, i) => s + i.quantidade, 0);
  const bases = basesPedidos + (Number(extras) || 0);
  const pedidosMarcados = new Set(itens.filter((i) => marcados.has(i.id)).map((i) => i.pedidos.numero)).size;

  const previsao = useMemo(() => {
    const v = r.versao;
    const fator = r.tipo === "base"
      ? (bases * (Number(peso) || 0)) / Number(v.massa_base_g)
      : (Number(qtdPreparo) || 0) / Number(v.rendimento || 1);
    const linhas = v.receita_versao_ingredientes.map((g) => ({ id: g.insumo_id, nome: g.insumos.nome, unidade: g.insumos.unidade, q: Number(g.quantidade) * fator }));
    if (r.tipo === "base") {
      const porUso = (u: string) => auxiliares.find((a) => a.uso_auxiliar === u);
      for (const [uso, q] of [["semola", bases * (aux.semola_g_por_base ?? 0)], ["saco_vacuo", bases * (aux.saco_vacuo_por_base ?? 0)], ["etiqueta", bases * (aux.etiqueta_por_base ?? 0)], ["molho", bases * (aux.molho_g_por_base ?? 0)]] as const) {
        const a = porUso(uso);
        if (a && q > 0) linhas.push({ id: a.id, nome: a.nome, unidade: a.unidade, q });
      }
    }
    return linhas;
  }, [r, bases, peso, qtdPreparo, aux, auxiliares]);

  function enviar() {
    setErro(null);
    iniciar(async () => {
      const res = await criarLote({
        receita_id: r.id,
        data_planejada: data,
        peso_bolinha_g: r.tipo === "base" ? Number(peso) : null,
        item_ids: r.tipo === "base" ? [...marcados] : [],
        bases_extras: r.tipo === "base" ? Number(extras) || 0 : 0,
        quantidade_planejada: r.tipo === "preparo" ? Number(String(qtdPreparo).replace(",", ".")) : null,
        observacoes: obs,
      });
      if (res?.erro) setErro(res.erro);
    });
  }

  return (
    <>
      {r.tipo === "base" && (
        <div className="cartao">
          <h2>Pedidos que entram neste lote</h2>
          {!itens.length ? <p className="suave">Nenhum pedido confirmado de {r.nome} na fila. Você pode produzir bases extras para estoque.</p> : (
            <div className="tabela-rolagem">
              <table>
                <thead><tr><th style={{ width: 40 }}><input type="checkbox" aria-label="Todos" checked={marcados.size === itens.length}
                  onChange={(e) => setMarcados(e.target.checked ? new Set(itens.map((i) => i.id)) : new Set())} /></th>
                  <th>Pedido</th><th>Cliente</th><th>Entrega</th><th className="dir">Bases</th></tr></thead>
                <tbody>
                  {itens.map((i) => (
                    <tr key={i.id}>
                      <td><input type="checkbox" aria-label={`Pedido ${i.pedidos.numero}`} checked={marcados.has(i.id)}
                        onChange={(e) => setMarcados((m) => { const n = new Set(m); if (e.target.checked) n.add(i.id); else n.delete(i.id); return n; })} /></td>
                      <td className="num">#{String(i.pedidos.numero).padStart(4, "0")}</td>
                      <td>{i.pedidos.cliente_nome}</td>
                      <td className="num">{formatarData(i.pedidos.entrega_em)}</td>
                      <td className="dir num">{i.quantidade}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="cartao">
        <h2>Lote</h2>
        <div className="grade">
          <div className="campo"><label htmlFor="data">Data prevista</label><input id="data" type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
          {r.tipo === "base" ? (
            <>
              <div className="campo"><label htmlFor="peso">Peso da bolinha (g)</label><input id="peso" type="number" step="1" value={peso} onChange={(e) => setPeso(e.target.value)} /></div>
              <div className="campo">
                <label htmlFor="extras">Bases extras</label>
                <input id="extras" type="number" min={0} value={extras} onChange={(e) => setExtras(e.target.value)} />
                <span className="ajuda">Margem para perdas ou estoque.</span>
              </div>
            </>
          ) : (
            <div className="campo">
              <label htmlFor="qtd">Quanto produzir ({r.produz?.unidade})</label>
              <input id="qtd" inputMode="decimal" value={qtdPreparo} onChange={(e) => setQtdPreparo(e.target.value)} />
              <span className="ajuda">A receita-base rende {fmt(Number(r.versao.rendimento))} {r.produz?.unidade} de {r.produz?.nome}.</span>
            </div>
          )}
        </div>
        <div className="campo"><label htmlFor="obs">Observações</label><input id="obs" value={obs} onChange={(e) => setObs(e.target.value)} /></div>
        {r.tipo === "base" && (
          <div className="linha-total forte">
            <span>{bases} bases · {fmt(bases * (Number(peso) || 0))} g de massa{pedidosMarcados ? ` · ${pedidosMarcados} ${pedidosMarcados === 1 ? "pedido" : "pedidos"}` : ""}</span>
          </div>
        )}
      </div>

      <div className="cartao">
        <h2>Ingredientes previstos</h2>
        <div className="tabela-rolagem">
          <table>
            <thead><tr><th>Insumo</th><th className="dir">Previsto</th><th className="dir">Em estoque</th></tr></thead>
            <tbody>
              {previsao.map((l) => {
                const tem = estoque[l.id] ?? 0;
                return (
                  <tr key={l.id}>
                    <td>{l.nome}</td>
                    <td className="dir num"><strong>{fmt(l.q)} {l.unidade}</strong></td>
                    {casa.includes(l.id)
                      ? <td className="dir suave">da casa</td>
                      : <td className="dir num" style={tem < l.q ? { color: "var(--erro)" } : undefined}>{fmt(tem)} {l.unidade}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {r.tipo === "base" && <p className="suave" style={{ fontSize: "0.85rem", marginTop: "0.5rem", marginBottom: 0 }}>Sacolas: uma por pedido, contada no primeiro lote em que o pedido entra. O consumo real você corrige durante o lote.</p>}
      </div>

      {erro && <div className="aviso erro" role="alert">{erro}</div>}
      <button type="button" className="bordo" disabled={pendente || (r.tipo === "base" ? bases <= 0 : !(Number(qtdPreparo) > 0))} onClick={enviar}>
        {pendente ? "Criando…" : "Criar lote"}
      </button>
    </>
  );
}
