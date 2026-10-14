"use client";
import { useState } from "react";
import { dimensionarPorBases, dimensionarPorFarinha, type IngredienteReceita } from "@/lib/receita";

export function Calculadora({ ingredientes, pesoPadrao, farinhaId }: { ingredientes: IngredienteReceita[]; pesoPadrao: number; farinhaId: string }) {
  const [modo, setModo] = useState<"bases" | "farinha">("bases");
  const [bases, setBases] = useState(10);
  const [peso, setPeso] = useState(pesoPadrao);
  const [farinha, setFarinha] = useState(1000);
  const [divisoes, setDivisoes] = useState(9);
  const temFarinha = ingredientes.some((i) => i.insumo_id === farinhaId);

  let resultado: { linhas: IngredienteReceita[]; resumo: string } | null = null;
  try {
    if (modo === "bases" && bases > 0 && peso > 0) {
      const r = dimensionarPorBases(ingredientes, bases, peso);
      resultado = { linhas: r.ingredientes, resumo: `${r.massaNecessaria.toLocaleString("pt-BR")} g de massa para ${bases} bases de ${peso} g` };
    } else if (modo === "farinha" && farinha > 0 && divisoes > 0 && temFarinha) {
      const r = dimensionarPorFarinha(ingredientes, farinha, divisoes, farinhaId);
      resultado = { linhas: r.ingredientes, resumo: `${r.massaTotal.toLocaleString("pt-BR")} g de massa ÷ ${divisoes} = bolinhas de ${r.pesoBolinha.toLocaleString("pt-BR")} g` };
    }
  } catch { resultado = null; }

  return (
    <div className="cartao">
      <h2>Calcular uma batelada</h2>
      <div className="acoes" style={{ marginBottom: "0.75rem" }}>
        <label className="check"><input type="radio" checked={modo === "bases"} onChange={() => setModo("bases")} /> Por número de bases</label>
        {temFarinha && <label className="check"><input type="radio" checked={modo === "farinha"} onChange={() => setModo("farinha")} /> Pela farinha disponível</label>}
      </div>
      <div className="grade">
        {modo === "bases" ? (
          <>
            <div className="campo"><label htmlFor="cb">Bases</label><input id="cb" type="number" min={1} value={bases} onChange={(e) => setBases(Number(e.target.value))} /></div>
            <div className="campo"><label htmlFor="cp">Peso da bolinha (g)</label><input id="cp" type="number" min={1} value={peso} onChange={(e) => setPeso(Number(e.target.value))} /></div>
          </>
        ) : (
          <>
            <div className="campo"><label htmlFor="cf">Farinha (g)</label><input id="cf" type="number" min={1} value={farinha} onChange={(e) => setFarinha(Number(e.target.value))} /></div>
            <div className="campo"><label htmlFor="cd">Dividir em</label><input id="cd" type="number" min={1} value={divisoes} onChange={(e) => setDivisoes(Number(e.target.value))} /></div>
          </>
        )}
      </div>
      {resultado && (
        <>
          <p><strong>{resultado.resumo}</strong></p>
          {resultado.linhas.map((i) => (
            <div key={i.insumo_id} className="linha-total"><span>{i.nome}</span><span className="num">{i.quantidade.toLocaleString("pt-BR")} {i.unidade}</span></div>
          ))}
          <p className="suave" style={{ fontSize: "0.85rem", marginTop: "0.5rem", marginBottom: 0 }}>Teórico, sem perdas. A produção com apontamento real chega na fase 3.</p>
        </>
      )}
    </div>
  );
}
