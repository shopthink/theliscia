"use client";
import { useMemo, useState, useTransition } from "react";
import { FormAcao } from "@/components/FormAcao";
import { formatarDataHora } from "@/lib/datas";
import {
  NUTRIENTES, alertasFrontais, arredondar, calcularPor100g, formatarValor, percentualVD, porcao,
  type ChaveNutriente, type InsumoNutri, type Tabela,
} from "@/lib/nutricao";
import { salvarRotulo, validarNutricao } from "../actions";

export interface DadosRotulo {
  id: string;
  rotulo_nome: string | null; rotulo_ingredientes: string | null; rotulo_alergenicos: string | null;
  rotulo_conservacao: string | null; rotulo_preparo: string | null; validade_dias: number | null;
  peso_assado_g: number | null; porcao_g: number | null; porcao_medida: string | null;
  nutricao: Tabela | null; nutricao_validada_em: string | null; nutricao_desatualizada: boolean;
}

export function Rotulo({ r, ingredientes, insumos, massaBaseG, pesoBolinhaG }: {
  r: DadosRotulo; ingredientes: { insumo_id: string; quantidade: number }[]; insumos: InsumoNutri[]; massaBaseG: number; pesoBolinhaG: number;
}) {
  const calc = useMemo(() => r.peso_assado_g
    ? calcularPor100g(ingredientes, insumos, massaBaseG, pesoBolinhaG, Number(r.peso_assado_g))
    : null, [r.peso_assado_g, ingredientes, insumos, massaBaseG, pesoBolinhaG]);
  const [valores, setValores] = useState<Record<string, string>>(() => {
    const base = r.nutricao ?? calc?.tabela;
    return Object.fromEntries(NUTRIENTES.map((n) => [n.chave, base ? String(arredondar(n.chave, Number(base[n.chave]))).replace(".", ",") : ""]));
  });
  const [msg, setMsg] = useState<{ erro?: string; ok?: string }>({});
  const [pendente, iniciar] = useTransition();
  const num = (t: string) => Number(String(t).replace(",", "."));
  const tabelaAtual = Object.fromEntries(NUTRIENTES.map((n) => [n.chave, num(valores[n.chave] ?? "")])) as Tabela;
  const alertas = alertasFrontais(tabelaAtual);
  const porc = r.porcao_g ? porcao(tabelaAtual, Number(r.porcao_g)) : null;

  return (
    <>
      <div className="cartao">
        <h2>Dados do rótulo</h2>
        <FormAcao acao={salvarRotulo} botao="Salvar dados do rótulo">
          <input type="hidden" name="receita_id" value={r.id} />
          <div className="campo"><label htmlFor="rn">Nome no rótulo</label><input id="rn" name="rotulo_nome" defaultValue={r.rotulo_nome ?? ""} /></div>
          <div className="campo"><label htmlFor="ri">Ingredientes (ordem decrescente de quantidade)</label><textarea id="ri" name="rotulo_ingredientes" defaultValue={r.rotulo_ingredientes ?? ""} />
            <span className="ajuda">Use os nomes como estão nos rótulos dos fornecedores (ex.: farinha de trigo enriquecida com ferro e ácido fólico).</span></div>
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
        </FormAcao>
      </div>

      <div className="cartao">
        <div className="acoes" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Tabela nutricional</h2>
          {r.nutricao_validada_em
            ? <span className={`selo ${r.nutricao_desatualizada ? "alerta" : "ok"}`}>{r.nutricao_desatualizada ? "Receita mudou depois da validação" : `Validada em ${formatarDataHora(r.nutricao_validada_em)}`}</span>
            : <span className="selo alerta">Não validada · etiqueta bloqueada</span>}
        </div>
        {!r.peso_assado_g ? (
          <div className="aviso alerta" style={{ marginTop: "0.75rem" }}>Informe e salve o peso da base assada para o sistema calcular a sugestão.</div>
        ) : (
          <p className="suave" style={{ fontSize: "0.9rem", marginTop: "0.6rem" }}>
            Sugestão calculada pela ficha técnica: uma bolinha de {pesoBolinhaG} g vira uma base de {Number(r.peso_assado_g)} g (a água evapora e concentra os nutrientes).
            Valide com nutricionista ou laudo antes de usar. Os campos abaixo são os que vão para a etiqueta.
            {calc && calc.semDados.length > 0 && <strong style={{ color: "var(--erro)" }}> Sem dados nutricionais: {calc.semDados.join(", ")} (contados como zero). Preencha em Insumos.</strong>}
          </p>
        )}
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
          {calc && <button type="button" className="contorno" onClick={() => setValores(Object.fromEntries(NUTRIENTES.map((n) => [n.chave, String(arredondar(n.chave, calc.tabela[n.chave])).replace(".", ",")])))}>Usar a sugestão</button>}
          <button type="button" disabled={pendente} onClick={() => {
            const v = Object.fromEntries(NUTRIENTES.map((n) => [n.chave, num(valores[n.chave] ?? "")]));
            if (Object.values(v).some((x) => !Number.isFinite(x) || x < 0) || NUTRIENTES.some((n) => (valores[n.chave] ?? "").trim() === "")) {
              setMsg({ erro: "Preencha todos os valores (use 0 quando for o caso)." });
              return;
            }
            if (!confirm("Confirmar que estes valores foram conferidos e podem ir para a etiqueta?")) return;
            iniciar(async () => setMsg(await validarNutricao(r.id, v)));
          }}>Validar tabela</button>
        </div>
      </div>
    </>
  );
}
