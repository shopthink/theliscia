import Link from "next/link";
import { exigirAdmin } from "@/lib/auth";
import { FormAcao } from "@/components/FormAcao";
import { basesPorKgFarinha } from "@/lib/receita";
import { criarReceita } from "./actions";

export const metadata = { title: "Receitas" };

export default async function Receitas() {
  const { supabase } = await exigirAdmin();
  const [{ data: receitas }, { data: insumos }] = await Promise.all([
    supabase.from("receitas")
      .select("id, nome, tipo, ativa, versao_atual_id, produz:insumos!receitas_produz_insumo_id_fkey(nome, unidade), receita_versoes!receita_versoes_receita_id_fkey(id, numero, peso_bolinha_g, massa_base_g, rendimento, receita_versao_ingredientes(insumo_id, quantidade, densidade_g))")
      .order("tipo").order("nome"),
    supabase.from("insumos").select("id, nome, unidade").eq("ativo", true).order("nome"),
  ]);
  const farinha = insumos?.find((i) => i.nome === "Farinha");
  const bases = (receitas ?? []).filter((r: any) => r.tipo === "base");
  const preparos = (receitas ?? []).filter((r: any) => r.tipo === "preparo");
  const atual = (r: any) => r.receita_versoes.find((x: any) => x.id === r.versao_atual_id);

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Receitas</h1>
          <p className="suave" style={{ margin: 0 }}>Fichas técnicas internas. O cliente nunca vê estas informações.</p>
        </div>
      </div>
      <div className="cartao">
        <h2>Bases de pizza</h2>
        <div className="tabela-rolagem">
          <table>
            <thead><tr><th>Receita</th><th>Versão</th><th className="dir">Bolinha</th><th className="dir">Massa da receita-base</th><th className="dir">Rende por kg de farinha*</th></tr></thead>
            <tbody>
              {bases.map((r: any) => {
                const v = atual(r);
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
        <h2>Preparos</h2>
        <p className="suave">Receitas que produzem um insumo para o estoque, como o molho caseiro.</p>
        {!preparos.length ? <div className="vazio">Nenhum preparo cadastrado.</div> : (
          <div className="tabela-rolagem">
            <table>
              <thead><tr><th>Preparo</th><th>Produz</th><th>Versão</th><th className="dir">Rende</th></tr></thead>
              <tbody>
                {preparos.map((r: any) => {
                  const v = atual(r);
                  return (
                    <tr key={r.id}>
                      <td><Link href={`/admin/receitas/${r.id}`}><strong>{r.nome}</strong></Link></td>
                      <td>{r.produz?.nome}</td>
                      <td>{v ? `v${v.numero}` : <span className="selo alerta">sem ficha</span>}</td>
                      <td className="dir num">{v ? `${Number(v.rendimento).toLocaleString("pt-BR")} ${r.produz?.unidade}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="cartao">
        <h2>Nova receita</h2>
        <FormAcao acao={criarReceita} botao="Criar" limparAoSalvar>
          <div className="grade">
            <div className="campo"><label htmlFor="nome">Nome</label><input id="nome" name="nome" placeholder="Ex.: Molho caseiro de tomate" required /></div>
            <div className="campo">
              <label htmlFor="tipo">Tipo</label>
              <select id="tipo" name="tipo" defaultValue="base"><option value="base">Base de pizza</option><option value="preparo">Preparo (produz um insumo)</option></select>
            </div>
            <div className="campo">
              <label htmlFor="produz_insumo_id">Se for preparo, produz</label>
              <select id="produz_insumo_id" name="produz_insumo_id" defaultValue="">
                <option value="">—</option>
                {(insumos ?? []).map((i) => <option key={i.id} value={i.id}>{i.nome} ({i.unidade})</option>)}
              </select>
            </div>
          </div>
        </FormAcao>
      </div>
    </>
  );
}
