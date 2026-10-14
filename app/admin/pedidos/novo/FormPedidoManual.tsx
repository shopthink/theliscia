"use client";
import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { formatarBRL, lerBRL } from "@/lib/dinheiro";
import { criarPedidoManual } from "../actions";

interface Campanha {
  id: string;
  nome: string;
  ativa: boolean;
  entrega_em: string;
  campanha_produtos: { receita_id: string; preco_centavos: number; ativo: boolean }[];
}

interface Linha { receita_id: string; quantidade: number; preco: string }

export function FormPedidoManual({ receitas, campanhas }: { receitas: { id: string; nome: string }[]; campanhas: Campanha[] }) {
  const inicial = campanhas.find((c) => c.ativa);
  const [campanhaId, setCampanhaId] = useState(inicial?.id ?? "");
  const [entrega, setEntrega] = useState(inicial?.entrega_em ?? "");
  const [modalidade, setModalidade] = useState("entrega");
  const camp = campanhas.find((c) => c.id === campanhaId);
  const precoSugerido = (rid: string) => {
    const p = camp?.campanha_produtos.find((x) => x.receita_id === rid && x.ativo);
    return p ? (p.preco_centavos / 100).toFixed(2).replace(".", ",") : "";
  };
  const [linhas, setLinhas] = useState<Linha[]>(
    receitas.map((r) => ({ receita_id: r.id, quantidade: 0, preco: precoSugerido(r.id) })),
  );
  const [estado, enviar] = useActionState(criarPedidoManual, {});

  const itens = linhas
    .filter((l) => l.quantidade > 0)
    .map((l) => ({ receita_id: l.receita_id, quantidade: l.quantidade, preco_centavos: lerBRL(l.preco) ?? -1 }));
  const total = useMemo(() => itens.reduce((s, i) => s + i.quantidade * Math.max(0, i.preco_centavos), 0), [itens]);
  const precoInvalido = itens.some((i) => i.preco_centavos < 0);

  return (
    <form action={enviar}>
      <input type="hidden" name="itens" value={JSON.stringify(itens)} />
      <div className="cartao">
        <h2>Itens</h2>
        <div className="campo">
          <label htmlFor="campanha_id">Campanha (opcional)</label>
          <select id="campanha_id" name="campanha_id" value={campanhaId} onChange={(e) => {
            const id = e.target.value;
            setCampanhaId(id);
            const c = campanhas.find((x) => x.id === id);
            if (c) {
              setEntrega(c.entrega_em);
              setLinhas((ls) => ls.map((l) => {
                const p = c.campanha_produtos.find((x) => x.receita_id === l.receita_id && x.ativo);
                return p ? { ...l, preco: (p.preco_centavos / 100).toFixed(2).replace(".", ",") } : l;
              }));
            }
          }}>
            <option value="">Sem campanha</option>
            {campanhas.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.ativa ? " (ativa)" : ""}</option>)}
          </select>
          <span className="ajuda">Escolher a campanha preenche data e preços; você pode alterar.</span>
        </div>
        <div className="tabela-rolagem">
          <table>
            <thead><tr><th>Receita</th><th style={{ width: 110 }}>Quantidade</th><th style={{ width: 140 }}>Preço por base (R$)</th><th className="dir">Subtotal</th></tr></thead>
            <tbody>
              {linhas.map((l, k) => {
                const r = receitas.find((x) => x.id === l.receita_id)!;
                const preco = lerBRL(l.preco);
                return (
                  <tr key={l.receita_id}>
                    <td>{r.nome}</td>
                    <td><input type="number" min={0} max={999} value={l.quantidade || ""} placeholder="0" aria-label={`Quantidade de ${r.nome}`}
                      onChange={(e) => setLinhas((ls) => ls.map((x, i) => i === k ? { ...x, quantidade: Math.max(0, Math.floor(Number(e.target.value) || 0)) } : x))} /></td>
                    <td><input inputMode="decimal" value={l.preco} placeholder="0,00" aria-label={`Preço de ${r.nome}`}
                      onChange={(e) => setLinhas((ls) => ls.map((x, i) => i === k ? { ...x, preco: e.target.value } : x))} /></td>
                    <td className="dir num">{l.quantidade && preco != null ? formatarBRL(l.quantidade * preco) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="linha-total forte"><span>Total</span><span className="num">{formatarBRL(total)}</span></div>
        {precoInvalido && <div className="aviso erro">Informe o preço de todos os itens com quantidade.</div>}
      </div>

      <div className="cartao">
        <h2>Cliente e entrega</h2>
        <div className="grade">
          <div className="campo"><label htmlFor="nome">Nome</label><input id="nome" name="nome" required /></div>
          <div className="campo"><label htmlFor="telefone">Telefone com DDD</label><input id="telefone" name="telefone" type="tel" required /></div>
        </div>
        <div className="grade">
          <div className="campo">
            <label htmlFor="modalidade">Entrega ou retirada</label>
            <select id="modalidade" name="modalidade" value={modalidade} onChange={(e) => setModalidade(e.target.value)}>
              <option value="entrega">Entrega</option><option value="retirada">Retirada</option>
            </select>
          </div>
          <div className="campo"><label htmlFor="entrega_em">Data</label><input id="entrega_em" name="entrega_em" type="date" value={entrega} onChange={(e) => setEntrega(e.target.value)} required /></div>
        </div>
        {modalidade === "entrega" && <div className="campo"><label htmlFor="endereco">Endereço</label><textarea id="endereco" name="endereco" /></div>}
        <div className="campo"><label htmlFor="observacoes">Observações</label><textarea id="observacoes" name="observacoes" /></div>
      </div>

      <div className="cartao">
        <h2>Já recebeu algum valor? (opcional)</h2>
        <div className="grade">
          <div className="campo"><label htmlFor="valor_pago">Valor recebido (R$)</label><input id="valor_pago" name="valor_pago" inputMode="decimal" placeholder="0,00" /></div>
          <div className="campo">
            <label htmlFor="metodo">Forma</label>
            <select id="metodo" name="metodo" defaultValue="pix"><option value="pix">Pix</option><option value="dinheiro">Dinheiro</option><option value="cartao">Cartão</option><option value="outro">Outro</option></select>
          </div>
          <div className="campo"><label htmlFor="referencia">Identificação (opcional)</label><input id="referencia" name="referencia" /></div>
        </div>
        <p className="suave" style={{ margin: 0 }}>Registre só o que você já conferiu na conta ou recebeu em mãos.</p>
      </div>

      {estado.erro && <div className="aviso erro" role="alert">{estado.erro}</div>}
      <Enviar desabilitado={!itens.length || precoInvalido} />
    </form>
  );
}

function Enviar({ desabilitado }: { desabilitado: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" className="bordo" disabled={desabilitado || pending}>{pending ? "Salvando…" : "Criar pedido"}</button>;
}
