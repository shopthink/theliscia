"use client";
import { useMemo, useState, useTransition } from "react";
import { FormAcao } from "@/components/FormAcao";
import { formatarDataHora } from "@/lib/datas";
import {
  NUTRIENTES, alertasFrontais, arredondar, calcularPor100g, formatarValor, percentualVD, porcao,
  type ChaveNutriente, type InsumoNutri, type Tabela,
} from "@/lib/nutricao";
import { chaveMarcas, nutricaoComMarca, sugerirIngredientes } from "@/lib/marcas";
import { salvarRotulo, validarNutricao } from "../actions";

export interface DadosRotulo {
  id: string;
  rotulo_nome: string | null; rotulo_alergenicos: string | null;
  rotulo_conservacao: string | null; rotulo_preparo: string | null; validade_dias: number | null;
  peso_assado_g: number | null; porcao_g: number | null; porcao_medida: string | null;
}
export interface MarcaRotulo extends Partial<InsumoNutri> { id: string; insumo_id: string; nome: string; nome_rotulo: string | null; em_uso: boolean }
export interface TabelaValidada { id: string; marcas: Record<string, string | null>; chave: string; nutricao: Tabela; ingredientes: string; validada_em: string; versao_atual: boolean }
interface Ingrediente { insumo_id: string; nome: string; quantidade: number; densidade_g?: number }

export function Rotulo({ r, ingredientes, insumos, marcas, tabelas, massaBaseG, pesoBolinhaG, combinacaoInicial }: {
  r: DadosRotulo; ingredientes: Ingrediente[]; insumos: InsumoNutri[]; marcas: MarcaRotulo[]; tabelas: TabelaValidada[];
  massaBaseG: number; pesoBolinhaG: number; combinacaoInicial?: Record<string, string | null> | null;
}) {
  const emUso = () => Object.fromEntries(ingredientes.map((i) => [i.insumo_id, marcas.find((m) => m.insumo_id === i.insumo_id && m.em_uso)?.id ?? null]));
  const [combo, setCombo] = useState<Record<string, string | null>>(() => {
    const base = emUso();
    if (combinacaoInicial) for (const i of ingredientes) if (i.insumo_id in combinacaoInicial) base[i.insumo_id] = combinacaoInicial[i.insumo_id] || null;
    return base;
  });
  const chave = chaveMarcas(combo);
  const existente = tabelas.find((t) => t.chave === chave) ?? null;
  const marcaDe = (insumoId: string) => marcas.find((m) => m.id === combo[insumoId]) ?? null;

  const calc = useMemo(() => {
    if (!r.peso_assado_g) return null;
    const ins = insumos.map((i) => nutricaoComMarca(i, marcaDe(i.id)));
    return calcularPor100g(ingredientes, ins, massaBaseG, pesoBolinhaG, Number(r.peso_assado_g));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.peso_assado_g, ingredientes, insumos, massaBaseG, pesoBolinhaG, chave]);
  const sugestaoTexto = sugerirIngredientes(ingredientes, marcaDe);

  const valoresDe = (t: Tabela | null | undefined) =>
    Object.fromEntries(NUTRIENTES.map((n) => [n.chave, t ? String(arredondar(n.chave, Number(t[n.chave]))).replace(".", ",") : ""]));
  const [valores, setValores] = useState<Record<string, string>>(() => valoresDe(existente?.nutricao ?? calc?.tabela));
  const [texto, setTexto] = useState(existente?.ingredientes ?? sugestaoTexto);
  const [msg, setMsg] = useState<{ erro?: string; ok?: string }>({});
  const [pendente, iniciar] = useTransition();

  function trocar(insumoId: string, marcaId: string) {
    const novo = { ...combo, [insumoId]: marcaId || null };
    setCombo(novo);
    setMsg({});
    const t = tabelas.find((x) => x.chave === chaveMarcas(novo));
    if (t) { setValores(valoresDe(t.nutricao)); setTexto(t.ingredientes); }
    else {
      const ins = insumos.map((i) => nutricaoComMarca(i, marcas.find((m) => m.id === novo[i.id]) ?? null));
      const c = r.peso_assado_g ? calcularPor100g(ingredientes, ins, massaBaseG, pesoBolinhaG, Number(r.peso_assado_g)) : null;
      setValores(valoresDe(c?.tabela));
      setTexto(sugerirIngredientes(ingredientes, (id) => marcas.find((m) => m.id === novo[id]) ?? null));
    }
  }

  const num = (t: string) => Number(String(t).replace(",", "."));
  const tabelaAtual = Object.fromEntries(NUTRIENTES.map((n) => [n.chave, num(valores[n.chave] ?? "")])) as Tabela;
  const alertas = alertasFrontais(tabelaAtual);
  const porc = r.porcao_g ? porcao(tabelaAtual, Number(r.porcao_g)) : null;
  const nomeMarca = (id: string | null | undefined) => (id ? marcas.find((m) => m.id === id)?.nome ?? "marca removida" : "sem marca");
  const semDadosMarca = ingredientes.filter((i) => combo[i.insumo_id] && marcaDe(i.insumo_id)?.nutri_kcal == null).map((i) => `${i.nome} (${nomeMarca(combo[i.insumo_id])})`);

  return (
    <>
      <div className="cartao">
        <h2>Dados do rótulo</h2>
        <FormAcao acao={salvarRotulo} botao="Salvar dados do rótulo">
          <input type="hidden" name="receita_id" value={r.id} />
          <div className="campo"><label htmlFor="rn">Nome no rótulo</label><input id="rn" name="rotulo_nome" defaultValue={r.rotulo_nome ?? ""} /></div>
          <div className="campo"><label htmlFor="ra">Alergênicos e glúten</label><input id="ra" name="rotulo_alergenicos" defaultValue={r.rotulo_alergenicos ?? ""} /></div>
          <div className="grade">
            <div className="campo"><label htmlFor="pa">Peso da base assada (g)</label><input id="pa" name="peso_assado_g" inputMode="decimal" defaultValue={r.peso_assado_g ?? ""} placeholder="Pese algumas e use a média" />
              <span className="ajuda">É o peso líquido da etiqueta e base do cálculo.</span></div>
            <div className="campo"><label htmlFor="pg">Porção (g)</label><input id="pg" name="porcao_g" inputMode="decimal" defaultValue={r.porcao_g ?? ""} /></div>
            <div className="campo"><label htmlFor="pm">Medida caseira da porção</label><input id="pm" name="porcao_medida" defaultValue={r.porcao_medida ?? ""} placeholder="Ex.: 1/4 de base" /></div>
            <div className="campo"><label htmlFor="vd">Validade congelado (dias)</label><input id="vd" name="validade_dias" inputMode="numeric" defaultValue={r.validade_dias ?? ""} />
              <span className="ajuda">Contada a partir da data em que foi assada.</span></div>
          </div>
          <div className="campo"><label htmlFor="rc">Conservação</label><input id="rc" name="rotulo_conservacao" defaultValue={r.rotulo_conservacao ?? ""} /></div>
          <div className="campo"><label htmlFor="rp">Modo de preparo</label><textarea id="rp" name="rotulo_preparo" defaultValue={r.rotulo_preparo ?? ""} /></div>
          <p className="ajuda">A lista de ingredientes fica em cada combinação de marcas, logo abaixo.</p>
        </FormAcao>
      </div>

      <div className="cartao" id="tabela">
        <h2>Tabela nutricional e ingredientes por combinação de marcas</h2>
        <p className="suave" style={{ fontSize: "0.9rem", marginTop: 0 }}>
          Cada combinação de marcas tem sua tabela e sua lista de ingredientes, validadas uma vez. A etiqueta de um lote usa a combinação das marcas que ele usou.
        </p>

        {tabelas.length > 0 && (
          <div className="tabela-rolagem" style={{ marginBottom: "1rem" }}>
            <table>
              <thead><tr><th>Combinações validadas</th><th>Validada em</th><th></th></tr></thead>
              <tbody>
                {tabelas.map((t) => (
                  <tr key={t.id} style={t.chave === chave ? { background: "var(--creme)" } : undefined}>
                    <td>{ingredientes.map((i) => `${i.nome}: ${nomeMarca(t.marcas[i.insumo_id])}`).join(" · ")}
                      {!t.versao_atual && <div><span className="selo alerta">feita numa versão anterior da receita</span></div>}</td>
                    <td className="num">{formatarDataHora(t.validada_em)}</td>
                    <td className="dir"><button type="button" className="contorno pequeno" onClick={() => {
                      setCombo(Object.fromEntries(ingredientes.map((i) => [i.insumo_id, t.marcas[i.insumo_id] ?? null])));
                      setValores(valoresDe(t.nutricao)); setTexto(t.ingredientes); setMsg({});
                    }}>Abrir</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="caixa-alta suave" style={{ marginBottom: "0.4rem" }}>Combinação</div>
        <div className="grade" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          {ingredientes.map((i) => {
            const ops = marcas.filter((m) => m.insumo_id === i.insumo_id);
            return (
              <div className="campo" key={i.insumo_id}>
                <label htmlFor={`cm-${i.insumo_id}`}>{i.nome}</label>
                <select id={`cm-${i.insumo_id}`} value={combo[i.insumo_id] ?? ""} onChange={(e) => trocar(i.insumo_id, e.target.value)}>
                  <option value="">Sem marca (genérico)</option>
                  {ops.map((m) => <option key={m.id} value={m.id}>{m.nome}{m.em_uso ? " (em uso)" : ""}</option>)}
                </select>
              </div>
            );
          })}
        </div>
        <div style={{ marginBottom: "0.75rem" }}>
          {existente
            ? <span className={`selo ${existente.versao_atual ? "ok" : "alerta"}`}>Combinação validada em {formatarDataHora(existente.validada_em)}</span>
            : <span className="selo alerta">Combinação ainda não validada · etiquetas com estas marcas ficam bloqueadas</span>}
        </div>

        {!r.peso_assado_g ? (
          <div className="aviso alerta">Informe e salve o peso da base assada para o sistema calcular a sugestão.</div>
        ) : (
          <p className="suave" style={{ fontSize: "0.9rem" }}>
            Sugestão calculada pela ficha técnica e pelas tabelas das marcas escolhidas: uma bolinha de {pesoBolinhaG} g vira uma base de {Number(r.peso_assado_g)} g.
            Valide com nutricionista ou laudo antes de usar.
            {calc && calc.semDados.length > 0 && <strong style={{ color: "var(--erro)" }}> Sem dados nutricionais: {calc.semDados.join(", ")} (contados como zero).</strong>}
            {semDadosMarca.length > 0 && <strong style={{ color: "var(--alerta)" }}> Marca sem tabela própria, usando a genérica: {semDadosMarca.join(", ")}.</strong>}
          </p>
        )}

        <div className="campo">
          <label htmlFor="ingredientes">Ingredientes (ordem decrescente de quantidade)</label>
          <textarea id="ingredientes" value={texto} onChange={(e) => setTexto(e.target.value)} />
          <span className="ajuda">
            Montado com o “nome no rótulo” de cada marca. <button type="button" className="link" onClick={() => setTexto(sugestaoTexto)}>Refazer a partir das marcas</button>
          </span>
        </div>

        <div className="tabela-rolagem">
          <table>
            <thead><tr><th>Por 100 g</th><th>Sugestão</th><th style={{ width: 130 }}>Valor validado</th>{porc && <th className="dir">Porção {Number(r.porcao_g)} g</th>}{porc && <th className="dir">%VD</th>}</tr></thead>
            <tbody>
              {NUTRIENTES.map((n) => (
                <tr key={n.chave}>
                  <td style={"recuo" in n ? { paddingLeft: "1.6rem" } : undefined}>{n.rotulo} ({n.unidade})</td>
                  <td className="num suave">{calc ? formatarValor(n.chave, calc.tabela[n.chave]) : "—"}</td>
                  <td><input inputMode="decimal" aria-label={n.rotulo} value={valores[n.chave] ?? ""} onChange={(e) => setValores((v) => ({ ...v, [n.chave]: e.target.value }))} /></td>
                  {porc && <td className="dir num">{formatarValor(n.chave, porc[n.chave as ChaveNutriente])}</td>}
                  {porc && <td className="dir num">{percentualVD(n.chave, porc[n.chave as ChaveNutriente]) ?? "**"}{percentualVD(n.chave, porc[n.chave as ChaveNutriente]) != null ? "%" : ""}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {alertas.length > 0 && (
          <div className="aviso alerta" style={{ marginTop: "0.75rem" }}>
            Com estes valores, a embalagem precisa da rotulagem frontal (lupa): <strong>ALTO EM {alertas.join(", ")}</strong>. A etiqueta já inclui.
          </div>
        )}
        {msg.erro && <div className="aviso erro" style={{ marginTop: "0.75rem" }}>{msg.erro}</div>}
        {msg.ok && <div className="aviso ok" style={{ marginTop: "0.75rem" }}>{msg.ok}</div>}
        <div className="acoes" style={{ marginTop: "0.75rem" }}>
          {calc && <button type="button" className="contorno" onClick={() => setValores(valoresDe(calc.tabela))}>Usar a sugestão</button>}
          <button type="button" disabled={pendente} onClick={() => {
            const v = Object.fromEntries(NUTRIENTES.map((n) => [n.chave, num(valores[n.chave] ?? "")]));
            if (Object.values(v).some((x) => !Number.isFinite(x) || x < 0) || NUTRIENTES.some((n) => (valores[n.chave] ?? "").trim() === "")) {
              setMsg({ erro: "Preencha todos os valores (use 0 quando for o caso)." });
              return;
            }
            if (texto.trim().length < 3) { setMsg({ erro: "Preencha a lista de ingredientes." }); return; }
            if (!confirm("Confirmar que a tabela e os ingredientes foram conferidos para estas marcas e podem ir para a etiqueta?")) return;
            iniciar(async () => setMsg(await validarNutricao(r.id, v, combo, texto)));
          }}>{existente ? "Validar de novo" : "Validar esta combinação"}</button>
        </div>
      </div>
    </>
  );
}
