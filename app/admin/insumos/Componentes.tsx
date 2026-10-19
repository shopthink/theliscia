import { FormAcao } from "@/components/FormAcao";
import { NUTRIENTES } from "@/lib/nutricao";
import { removerEmbalagem, salvarEmbalagem, salvarNutricaoInsumo } from "./actions";

const UN_EMB: Record<string, { v: string; r: string }[]> = {
  g: [{ v: "kg", r: "kg" }, { v: "g", r: "g" }],
  ml: [{ v: "l", r: "L" }, { v: "ml", r: "ml" }],
  un: [{ v: "un", r: "unidades" }],
};

/** Embalagens de um insumo; com marca, ficam ligadas a ela (Caputo 1 kg). */
export function Embalagens({ insumoId, unidade, marcaId, lista }: {
  insumoId: string; unidade: string; marcaId?: string | null; lista: { id: string; nome: string; conteudo: number | string }[];
}) {
  const s = marcaId ?? insumoId;
  const ordenada = [...lista].sort((a, b) => Number(a.conteudo) - Number(b.conteudo));
  return (
    <div>
      <div className="caixa-alta suave" style={{ marginBottom: "0.4rem" }}>Embalagens em que você compra</div>
      {!ordenada.length && <p className="suave" style={{ fontSize: "0.9rem" }}>Nenhuma ainda. Ex.: pacote 5 kg, lata 350 ml, caixa com 100 un.</p>}
      <div className="acoes" style={{ marginBottom: "0.6rem" }}>
        {ordenada.map((e) => (
          <FormAcao key={e.id} acao={removerEmbalagem} botao={`${e.nome}  ×`} classeBotao="contorno pequeno" confirmar={`Remover ${e.nome}?`}>
            <input type="hidden" name="id" value={e.id} />
          </FormAcao>
        ))}
      </div>
      <FormAcao acao={salvarEmbalagem} botao="Adicionar embalagem" classeBotao="contorno pequeno" limparAoSalvar>
        <input type="hidden" name="insumo_id" value={insumoId} />
        {marcaId && <input type="hidden" name="marca_id" value={marcaId} />}
        <div className="grade" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
          <div className="campo"><label htmlFor={`en-${s}`}>Nome (opcional)</label><input id={`en-${s}`} name="nome" placeholder="Ex.: Pacote 1 kg" /></div>
          <div className="campo"><label htmlFor={`ec-${s}`}>Conteúdo</label><input id={`ec-${s}`} name="conteudo" inputMode="decimal" required placeholder="Ex.: 5" /></div>
          <div className="campo">
            <label htmlFor={`eu-${s}`}>Unidade</label>
            <select id={`eu-${s}`} name="unidade" defaultValue={UN_EMB[unidade][0].v}>
              {UN_EMB[unidade].map((u) => <option key={u.v} value={u.v}>{u.r}</option>)}
            </select>
          </div>
        </div>
      </FormAcao>
    </div>
  );
}

/** Tabela nutricional do insumo (genérica) ou de uma marca. */
export function FormNutricao({ insumoId, unidade, marcaId, valores, titulo }: {
  insumoId: string; unidade: string; marcaId?: string | null; valores: Record<string, any>; titulo: string;
}) {
  const s = marcaId ?? insumoId;
  const por = unidade === "ml" ? "100 ml" : unidade === "un" ? "unidade" : "100 g";
  const tem = valores.nutri_kcal != null;
  return (
    <details>
      <summary className="caixa-alta suave" style={{ cursor: "pointer" }}>
        {titulo} (por {por}) {tem ? <span className="selo ok">preenchida</span> : <span className="selo alerta">sem dados</span>}
      </summary>
      <FormAcao acao={salvarNutricaoInsumo} botao="Salvar tabela" classeBotao="contorno pequeno">
        <input type="hidden" name="id" value={insumoId} />
        {marcaId && <input type="hidden" name="marca_id" value={marcaId} />}
        <div className="grade" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginTop: "0.6rem" }}>
          {NUTRIENTES.map((n) => (
            <div className="campo" key={n.chave}>
              <label htmlFor={`${n.chave}-${s}`}>{n.rotulo} ({n.unidade})</label>
              <input id={`${n.chave}-${s}`} name={n.chave} inputMode="decimal"
                defaultValue={valores[`nutri_${n.chave}`] != null ? String(Number(valores[`nutri_${n.chave}`])).replace(".", ",") : ""} />
            </div>
          ))}
        </div>
        <div className="campo"><label htmlFor={`fonte-${s}`}>Fonte dos dados</label>
          <input id={`fonte-${s}`} name="fonte" defaultValue={valores.nutri_fonte ?? ""} placeholder="Ex.: rótulo do pacote, foto de 10/2026" />
          {!marcaId && <span className="ajuda">Usada quando a marca não tem tabela própria. Valores pré-preenchidos são referências aproximadas.</span>}
        </div>
      </FormAcao>
    </details>
  );
}
