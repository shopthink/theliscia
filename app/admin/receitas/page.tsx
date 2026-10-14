import Link from "next/link";
import { exigirAdmin } from "@/lib/auth";
import { FormAcao } from "@/components/FormAcao";
import { basesPorKgFarinha } from "@/lib/receita";
import { criarReceita } from "./actions";

export const metadata = { title: "Receitas" };

export default async function Receitas() {
  const { supabase } = await exigirAdmin();
  const [{ data: receitas }, { data: farinha }] = await Promise.all([
    supabase.from("receitas").select("id, nome, ativa, versao_atual_id, receita_versoes!receita_versoes_receita_id_fkey(id, numero, peso_bolinha_g, massa_base_g, receita_versao_ingredientes(insumo_id, quantidade, densidade_g))").order("nome"),
    supabase.from("insumos").select("id").eq("nome", "Farinha").maybeSingle(),
  ]);
  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Receitas</h1>
          <p className="suave" style={{ margin: 0 }}>Fichas técnicas internas. O cliente nunca vê estas informações.</p>
        </div>
      </div>
      <div className="cartao">
        <div className="tabela-rolagem">
          <table>
            <thead><tr><th>Receita</th><th>Versão</th><th className="dir">Bolinha</th><th className="dir">Massa da receita-base</th><th className="dir">Rende por kg de farinha*</th></tr></thead>
            <tbody>
              {(receitas ?? []).map((r: any) => {
                const v = r.receita_versoes.find((x: any) => x.id === r.versao_atual_id);
                const rend = v && farinha ? basesPorKgFarinha(v.receita_versao_ingredientes.map((i: any) => ({ ...i, quantidade: Number(i.quantidade), densidade_g: Number(i.densidade_g) })), Number(v.peso_bolinha_g), farinha.id) : null;
                return (
                  <tr key={r.id}>
                    <td><Link href={`/admin/receitas/${r.id}`}><strong>{r.nome}</strong></Link></td>
                    <td>{v ? `v${v.numero}` : <span className="selo alerta">sem ficha</span>}</td>
                    <td className="dir num">{v ? `${Number(v.peso_bolinha_g).toLocaleString("pt-BR")} g` : "—"}</td>
                    <td className="dir num">{v ? `${Number(v.massa_base_g).toLocaleString("pt-BR")} g` : "—"}</td>
                    <td className="dir num">{rend != null ? `${rend.toLocaleString("pt-BR")} bases` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="suave" style={{ fontSize: "0.85rem", marginTop: "0.75rem", marginBottom: 0 }}>* Teórico, antes das perdas. Densidades: água e cerveja 1 g/ml, azeite 0,91 g/ml (aproximações).</p>
      </div>
      <div className="cartao">
        <h2>Nova receita</h2>
        <FormAcao acao={criarReceita} botao="Criar" limparAoSalvar>
          <div className="campo"><label htmlFor="nome">Nome</label><input id="nome" name="nome" placeholder="Ex.: Massa fresca congelada" required /></div>
        </FormAcao>
      </div>
    </>
  );
}
