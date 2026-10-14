"use client";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { massaBase } from "@/lib/receita";
import { salvarNovaVersao } from "../actions";

interface Ing { insumo_id: string; quantidade: number; densidade_g: number }

export function EditorReceita({ receitaId, insumos, iniciais, peso }: {
  receitaId: string; insumos: { id: string; nome: string; unidade: string }[]; iniciais: Ing[]; peso: number;
}) {
  const [linhas, setLinhas] = useState<Ing[]>(iniciais.length ? iniciais.map(({ insumo_id, quantidade, densidade_g }) => ({ insumo_id, quantidade, densidade_g })) : [{ insumo_id: "", quantidade: 0, densidade_g: 1 }]);
  const [estado, enviar] = useActionState(salvarNovaVersao, {});
  const validas = linhas.filter((l) => l.insumo_id && l.quantidade > 0);
  const unidade = (id: string) => insumos.find((i) => i.id === id)?.unidade ?? "";
  const set = (k: number, p: Partial<Ing>) => setLinhas((ls) => ls.map((l, i) => (i === k ? { ...l, ...p } : l)));

  return (
    <form action={enviar}>
      <input type="hidden" name="receita_id" value={receitaId} />
      <input type="hidden" name="ingredientes" value={JSON.stringify(validas)} />
      {estado.erro && <div className="aviso erro">{estado.erro}</div>}
      {estado.ok && <div className="aviso ok">{estado.ok}</div>}
      <div className="tabela-rolagem">
        <table>
          <thead><tr><th>Insumo</th><th style={{ width: 130 }}>Quantidade</th><th style={{ width: 130 }}>g por unidade</th><th></th></tr></thead>
          <tbody>
            {linhas.map((l, k) => (
              <tr key={k}>
                <td>
                  <select value={l.insumo_id} aria-label="Insumo" onChange={(e) => set(k, { insumo_id: e.target.value, densidade_g: unidade(e.target.value) === "un" ? 1 : l.densidade_g })}>
                    <option value="">Escolha…</option>
                    {insumos.map((i) => <option key={i.id} value={i.id}>{i.nome} ({i.unidade})</option>)}
                  </select>
                </td>
                <td><input type="number" step="0.1" min={0} value={l.quantidade || ""} aria-label="Quantidade" onChange={(e) => set(k, { quantidade: Number(e.target.value) })} /></td>
                <td><input type="number" step="0.01" min={0.01} value={l.densidade_g} aria-label="Gramas por unidade" onChange={(e) => set(k, { densidade_g: Number(e.target.value) })} /></td>
                <td><button type="button" className="contorno pequeno" onClick={() => setLinhas((ls) => ls.filter((_, i) => i !== k))} aria-label="Remover">×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="acoes" style={{ margin: "0.75rem 0" }}>
        <button type="button" className="contorno pequeno" onClick={() => setLinhas((ls) => [...ls, { insumo_id: "", quantidade: 0, densidade_g: 1 }])}>Adicionar ingrediente</button>
        <span className="suave">Massa estimada: <strong>{massaBase(validas).toLocaleString("pt-BR")} g</strong></span>
      </div>
      <p className="suave" style={{ fontSize: "0.85rem" }}>“g por unidade” serve para estimar a massa: 1 para g, água e cerveja; 0,91 para azeite. Ajuste se aferir.</p>
      <div className="grade">
        <div className="campo"><label htmlFor="peso">Peso da bolinha (g)</label><input id="peso" name="peso_bolinha_g" type="number" step="0.1" defaultValue={peso} required /></div>
        <div className="campo"><label htmlFor="obs">O que mudou?</label><input id="obs" name="observacoes" placeholder="Ex.: hidratação ajustada" /></div>
      </div>
      <Enviar />
    </form>
  );
}

function Enviar() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar nova versão"}</button>;
}
