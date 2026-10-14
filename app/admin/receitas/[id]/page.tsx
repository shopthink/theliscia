import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirAdmin } from "@/lib/auth";
import { formatarDataHora } from "@/lib/datas";
import { EditorReceita } from "./EditorReceita";
import { Calculadora } from "./Calculadora";

export const metadata = { title: "Receita" };

export default async function Receita({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await exigirAdmin();
  const [{ data: r }, { data: insumos }] = await Promise.all([
    supabase.from("receitas").select("id, nome, versao_atual_id, receita_versoes!receita_versoes_receita_id_fkey(id, numero, peso_bolinha_g, massa_base_g, observacoes, criado_em, receita_versao_ingredientes(insumo_id, quantidade, densidade_g, insumos(nome, unidade)))").eq("id", id).maybeSingle(),
    supabase.from("insumos").select("id, nome, unidade, categoria").eq("ativo", true).order("nome"),
  ]);
  if (!r) notFound();
  const versoes = [...(r.receita_versoes as any[])].sort((a, b) => b.numero - a.numero);
  const atual = versoes.find((v) => v.id === r.versao_atual_id);
  const ings = (atual?.receita_versao_ingredientes ?? []).map((i: any) => ({
    insumo_id: i.insumo_id, nome: i.insumos.nome, unidade: i.insumos.unidade, quantidade: Number(i.quantidade), densidade_g: Number(i.densidade_g),
  }));
  const farinha = insumos?.find((i) => i.nome === "Farinha")?.id ?? "";

  return (
    <>
      <div className="cabecalho">
        <div>
          <Link href="/admin/receitas" className="suave">← Receitas</Link>
          <h1>{r.nome} {atual && <span className="selo">v{atual.numero}</span>}</h1>
        </div>
      </div>
      {atual && (
        <div className="cartao">
          <h2>Ficha técnica atual</h2>
          <div className="tabela-rolagem">
            <table>
              <thead><tr><th>Ingrediente</th><th className="dir">Quantidade</th></tr></thead>
              <tbody>{ings.map((i: any) => <tr key={i.insumo_id}><td>{i.nome}</td><td className="dir num">{i.quantidade.toLocaleString("pt-BR")} {i.unidade}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="linha-total forte"><span>Massa estimada</span><span className="num">{Number(atual.massa_base_g).toLocaleString("pt-BR")} g</span></div>
          <div className="linha-total"><span>Peso da bolinha</span><span className="num">{Number(atual.peso_bolinha_g).toLocaleString("pt-BR")} g</span></div>
          {atual.observacoes && <p className="suave" style={{ marginTop: "0.5rem" }}>{atual.observacoes}</p>}
        </div>
      )}
      {atual && <Calculadora ingredientes={ings} pesoPadrao={Number(atual.peso_bolinha_g)} farinhaId={farinha} />}
      <div className="cartao">
        <h2>{atual ? "Editar (cria uma nova versão)" : "Cadastrar ficha técnica"}</h2>
        <p className="suave">Editar nunca altera pedidos ou lotes que já usaram a versão anterior.</p>
        <EditorReceita receitaId={r.id} insumos={insumos ?? []} iniciais={ings} peso={atual ? Number(atual.peso_bolinha_g) : 180} />
      </div>
      {versoes.length > 1 && (
        <div className="cartao">
          <h2>Histórico</h2>
          {versoes.map((v) => (
            <div key={v.id} className="linha-total">
              <span>v{v.numero} · bolinha {Number(v.peso_bolinha_g).toLocaleString("pt-BR")} g · massa {Number(v.massa_base_g).toLocaleString("pt-BR")} g</span>
              <span className="suave">{formatarDataHora(v.criado_em)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
