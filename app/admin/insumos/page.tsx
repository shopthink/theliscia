import { exigirAdmin } from "@/lib/auth";
import { FormAcao } from "@/components/FormAcao";
import Link from "next/link";
import { salvarInsumo } from "./actions";

export const metadata = { title: "Insumos" };

function precoExibido(centavosPorUnidade: number | null, unidade: string) {
  if (centavosPorUnidade == null) return "";
  const reais = unidade === "un" ? centavosPorUnidade / 100 : (centavosPorUnidade * 1000) / 100;
  return reais.toFixed(2).replace(".", ",");
}
const POR: Record<string, string> = { g: "por kg", ml: "por litro", un: "por unidade" };

export default async function Insumos() {
  const { supabase } = await exigirAdmin();
  const { data: insumos } = await supabase.from("insumos").select("*, insumo_embalagens(id), marcas(id, nome, em_uso, ativo)").order("categoria").order("nome");
  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Insumos</h1>
          <p className="suave" style={{ margin: 0 }}>
            Cada insumo é o ingrediente genérico da receita. As marcas que você compra, com tabela nutricional, embalagens, preço pago e perdas, ficam dentro de cada um.
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
          <div className="acoes" style={{ justifyContent: "space-between", borderTop: "1px solid var(--creme-2)", marginTop: "0.6rem", paddingTop: "0.7rem" }}>
            <span className="suave" style={{ fontSize: "0.9rem" }}>
              {(i.marcas ?? []).filter((m: any) => m.ativo).length
                ? <>Marcas: {(i.marcas ?? []).filter((m: any) => m.ativo).map((m: any) => m.em_uso ? `${m.nome} (em uso)` : m.nome).join(", ")}</>
                : "Nenhuma marca cadastrada"}
              {" · "}{(i.insumo_embalagens ?? []).length} {(i.insumo_embalagens ?? []).length === 1 ? "embalagem" : "embalagens"}
            </span>
            <Link className="botao contorno pequeno" href={`/admin/insumos/${i.id}`}>Marcas, estoque e comparativo →</Link>
          </div>
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

