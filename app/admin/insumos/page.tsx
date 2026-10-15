import { exigirAdmin } from "@/lib/auth";
import { FormAcao } from "@/components/FormAcao";
import { removerEmbalagem, salvarEmbalagem, salvarInsumo, salvarNutricaoInsumo } from "./actions";
import { NUTRIENTES } from "@/lib/nutricao";

export const metadata = { title: "Insumos" };

function precoExibido(centavosPorUnidade: number | null, unidade: string) {
  if (centavosPorUnidade == null) return "";
  const reais = unidade === "un" ? centavosPorUnidade / 100 : (centavosPorUnidade * 1000) / 100;
  return reais.toFixed(2).replace(".", ",");
}
const POR: Record<string, string> = { g: "por kg", ml: "por litro", un: "por unidade" };

export default async function Insumos() {
  const { supabase } = await exigirAdmin();
  const { data: insumos } = await supabase.from("insumos").select("*, insumo_embalagens(id, nome, conteudo, unidade)").order("categoria").order("nome");
  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Insumos</h1>
          <p className="suave" style={{ margin: 0 }}>
            Preço de referência é a sua estimativa, usada enquanto não houver compras cadastradas. Não é cotação atual.
          </p>
        </div>
      </div>
      {(insumos ?? []).map((i: any) => (
        <div className="cartao" key={i.id}>
          <FormAcao acao={salvarInsumo} botao="Salvar" classeBotao="pequeno">
            <input type="hidden" name="id" value={i.id} />
            <input type="hidden" name="versao" value={i.versao} />
            <input type="hidden" name="unidade" value={i.unidade} />
            <Campos i={i} />
          </FormAcao>
          <Embalagens i={i} />
          {i.categoria !== "embalagem" && <Nutricao i={i} />}
        </div>
      ))}
      <div className="cartao">
        <h2>Novo insumo</h2>
        <FormAcao acao={salvarInsumo} botao="Cadastrar" limparAoSalvar>
          <Campos i={{ categoria: "ingrediente", entra_lista_compras: true }} novo />
        </FormAcao>
      </div>
    </>
  );
}

function Campos({ i, novo }: { i: any; novo?: boolean }) {
  const s = i.id ?? "novo";
  return (
    <div className="grade">
      <div className="campo">
        <label htmlFor={`n-${s}`}>Nome</label>
        <input id={`n-${s}`} name="nome" defaultValue={i.nome ?? ""} required />
      </div>
      {novo ? (
        <div className="campo">
          <label htmlFor={`u-${s}`}>Unidade de controle</label>
          <select id={`u-${s}`} name="unidade" defaultValue="g"><option value="g">gramas (g)</option><option value="ml">mililitros (ml)</option><option value="un">unidades (un)</option></select>
          <span className="ajuda">Evite trocar depois: quantidades antigas ficariam erradas.</span>
        </div>
      ) : (
        <div className="campo"><label>Unidade</label><input value={i.unidade} disabled /></div>
      )}
      <div className="campo">
        <label htmlFor={`c-${s}`}>Categoria</label>
        <select id={`c-${s}`} name="categoria" defaultValue={i.categoria}>
          <option value="ingrediente">Ingrediente</option><option value="embalagem">Embalagem</option><option value="outro">Outro</option>
        </select>
      </div>
      <div className="campo">
        <label htmlFor={`p-${s}`}>Preço de referência (R$ {novo ? "por kg, litro ou unidade" : POR[i.unidade]})</label>
        <input id={`p-${s}`} name="preco" inputMode="decimal" defaultValue={precoExibido(i.preco_ref_centavos, i.unidade)} placeholder="sem estimativa" />
      </div>
      <div className="campo" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor={`o-${s}`}>Observações</label>
        <input id={`o-${s}`} name="observacoes" defaultValue={i.observacoes ?? ""} />
      </div>
      <div className="acoes" style={{ gridColumn: "1 / -1", marginBottom: "0.75rem" }}>
        <label className="check"><input type="checkbox" name="entra_lista_compras" defaultChecked={i.entra_lista_compras} /> Entra na lista de compras</label>
        {!novo && <label className="check"><input type="checkbox" name="ativo" defaultChecked={i.ativo} /> Ativo</label>}
      </div>
    </div>
  );
}

const UN_EMB: Record<string, { v: string; r: string }[]> = {
  g: [{ v: "kg", r: "kg" }, { v: "g", r: "g" }],
  ml: [{ v: "l", r: "L" }, { v: "ml", r: "ml" }],
  un: [{ v: "un", r: "unidades" }],
};

function Embalagens({ i }: { i: any }) {
  const lista = [...(i.insumo_embalagens ?? [])].sort((a: any, b: any) => Number(a.conteudo) - Number(b.conteudo));
  return (
    <div style={{ borderTop: "1px solid var(--creme-2)", marginTop: "0.9rem", paddingTop: "0.9rem" }}>
      <div className="caixa-alta suave" style={{ marginBottom: "0.4rem" }}>Embalagens em que você compra</div>
      {!lista.length && <p className="suave" style={{ fontSize: "0.9rem" }}>Nenhuma ainda. Ex.: pacote 5 kg, lata 350 ml, caixa com 100 un.</p>}
      <div className="acoes" style={{ marginBottom: "0.6rem" }}>
        {lista.map((e: any) => (
          <FormAcao key={e.id} acao={removerEmbalagem} botao={`${e.nome}  ×`} classeBotao="contorno pequeno" confirmar={`Remover ${e.nome}?`}>
            <input type="hidden" name="id" value={e.id} />
          </FormAcao>
        ))}
      </div>
      <FormAcao acao={salvarEmbalagem} botao="Adicionar embalagem" classeBotao="contorno pequeno" limparAoSalvar>
        <input type="hidden" name="insumo_id" value={i.id} />
        <div className="grade" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
          <div className="campo"><label htmlFor={`en-${i.id}`}>Nome (opcional)</label><input id={`en-${i.id}`} name="nome" placeholder="Ex.: Lata 400 g" /></div>
          <div className="campo"><label htmlFor={`ec-${i.id}`}>Conteúdo</label><input id={`ec-${i.id}`} name="conteudo" inputMode="decimal" required placeholder="Ex.: 5" /></div>
          <div className="campo">
            <label htmlFor={`eu-${i.id}`}>Unidade</label>
            <select id={`eu-${i.id}`} name="unidade" defaultValue={UN_EMB[i.unidade][0].v}>
              {UN_EMB[i.unidade].map((u) => <option key={u.v} value={u.v}>{u.r}</option>)}
            </select>
          </div>
        </div>
      </FormAcao>
    </div>
  );
}

function Nutricao({ i }: { i: any }) {
  const por = i.unidade === "ml" ? "100 ml" : i.unidade === "un" ? "unidade" : "100 g";
  const tem = i.nutri_kcal != null;
  return (
    <details style={{ borderTop: "1px solid var(--creme-2)", marginTop: "0.9rem", paddingTop: "0.9rem" }}>
      <summary className="caixa-alta suave" style={{ cursor: "pointer" }}>
        Tabela nutricional (por {por}) {tem ? <span className="selo ok">preenchida</span> : <span className="selo alerta">sem dados</span>}
      </summary>
      <FormAcao acao={salvarNutricaoInsumo} botao="Salvar tabela do insumo" classeBotao="contorno pequeno">
        <input type="hidden" name="id" value={i.id} />
        <div className="grade" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginTop: "0.6rem" }}>
          {NUTRIENTES.map((n) => (
            <div className="campo" key={n.chave}>
              <label htmlFor={`${n.chave}-${i.id}`}>{n.rotulo} ({n.unidade})</label>
              <input id={`${n.chave}-${i.id}`} name={n.chave} inputMode="decimal"
                defaultValue={i[`nutri_${n.chave}`] != null ? String(Number(i[`nutri_${n.chave}`])).replace(".", ",") : ""} />
            </div>
          ))}
        </div>
        <div className="campo"><label htmlFor={`fonte-${i.id}`}>Fonte dos dados</label>
          <input id={`fonte-${i.id}`} name="fonte" defaultValue={i.nutri_fonte ?? ""} placeholder="Ex.: rótulo da farinha marca X" />
          <span className="ajuda">Prefira o rótulo do produto que você compra. Valores pré-preenchidos são referências aproximadas.</span>
        </div>
      </FormAcao>
    </details>
  );
}
