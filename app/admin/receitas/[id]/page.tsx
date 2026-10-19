import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirAdmin } from "@/lib/auth";
import { formatarDataHora } from "@/lib/datas";
import { EditorReceita } from "./EditorReceita";
import { Calculadora } from "./Calculadora";
import { Rotulo } from "./Rotulo";

export const metadata = { title: "Receita" };

export default async function Receita({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ marcas?: string }> }) {
  const { id } = await params;
  const { marcas: marcasParam } = await searchParams;
  let combinacaoInicial: Record<string, string | null> | null = null;
  try { combinacaoInicial = marcasParam ? JSON.parse(marcasParam) : null; } catch { combinacaoInicial = null; }
  const { supabase } = await exigirAdmin();
  const [{ data: r }, { data: insumos }] = await Promise.all([
    supabase.from("receitas").select("id, nome, tipo, versao_atual_id, rotulo_nome, rotulo_alergenicos, rotulo_conservacao, rotulo_preparo, validade_dias, peso_assado_g, porcao_g, porcao_medida, produz:insumos!receitas_produz_insumo_id_fkey(nome, unidade), receita_versoes!receita_versoes_receita_id_fkey(id, numero, peso_bolinha_g, massa_base_g, rendimento, observacoes, criado_em, receita_versao_ingredientes(insumo_id, quantidade, densidade_g, insumos(nome, unidade)))").eq("id", id).maybeSingle(),
    supabase.from("insumos").select("id, nome, unidade, categoria, nutri_kcal, nutri_carboidratos_g, nutri_acucares_totais_g, nutri_acucares_adic_g, nutri_proteinas_g, nutri_gorduras_g, nutri_saturadas_g, nutri_trans_g, nutri_fibras_g, nutri_sodio_mg").eq("ativo", true).order("nome"),
  ]);
  if (!r) notFound();
  const [{ data: marcas }, { data: tabelas }] = await Promise.all([
    supabase.from("marcas").select("id, insumo_id, nome, nome_rotulo, em_uso, nutri_kcal, nutri_carboidratos_g, nutri_acucares_totais_g, nutri_acucares_adic_g, nutri_proteinas_g, nutri_gorduras_g, nutri_saturadas_g, nutri_trans_g, nutri_fibras_g, nutri_sodio_mg").eq("ativo", true).order("nome"),
    supabase.from("receita_tabelas").select("id, marcas, chave, nutricao, ingredientes, validada_em, receita_versao_id").eq("receita_id", id).order("validada_em", { ascending: false }),
  ]);
  const versoes = [...(r.receita_versoes as any[])].sort((a, b) => b.numero - a.numero);
  const atual = versoes.find((v) => v.id === r.versao_atual_id);
  const ings = (atual?.receita_versao_ingredientes ?? []).map((i: any) => ({
    insumo_id: i.insumo_id, nome: i.insumos.nome, unidade: i.insumos.unidade, quantidade: Number(i.quantidade), densidade_g: Number(i.densidade_g),
  }));
  const farinha = insumos?.find((i) => i.nome === "Farinha")?.id ?? "";
  const preparo = r.tipo === "preparo";
  const produz = (r as any).produz as { nome: string; unidade: string } | null;

  return (
    <>
      <div className="cabecalho">
        <div>
          <Link href="/admin/receitas" className="suave">← Receitas</Link>
          <h1>{r.nome} {atual && <span className="selo">v{atual.numero}</span>}</h1>
          {preparo && produz && <p className="suave" style={{ margin: 0 }}>Preparo: produz {produz.nome} para o estoque.</p>}
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
          {preparo ? (
            <div className="linha-total forte"><span>Rende</span><span className="num">{Number(atual.rendimento).toLocaleString("pt-BR")} {produz?.unidade}</span></div>
          ) : (
            <>
              <div className="linha-total forte"><span>Massa estimada</span><span className="num">{Number(atual.massa_base_g).toLocaleString("pt-BR")} g</span></div>
              <div className="linha-total"><span>Peso da bolinha</span><span className="num">{Number(atual.peso_bolinha_g).toLocaleString("pt-BR")} g</span></div>
            </>
          )}
          {atual.observacoes && <p className="suave" style={{ marginTop: "0.5rem" }}>{atual.observacoes}</p>}
        </div>
      )}
      {atual && !preparo && <Calculadora ingredientes={ings} pesoPadrao={Number(atual.peso_bolinha_g)} farinhaId={farinha} />}
      {atual && !preparo && (
        <Rotulo
          r={{
            id: r.id, rotulo_nome: (r as any).rotulo_nome, rotulo_alergenicos: (r as any).rotulo_alergenicos,
            rotulo_conservacao: (r as any).rotulo_conservacao, rotulo_preparo: (r as any).rotulo_preparo, validade_dias: (r as any).validade_dias,
            peso_assado_g: (r as any).peso_assado_g != null ? Number((r as any).peso_assado_g) : null,
            porcao_g: (r as any).porcao_g != null ? Number((r as any).porcao_g) : null, porcao_medida: (r as any).porcao_medida,
          }}
          ingredientes={ings.map((i: any) => ({ insumo_id: i.insumo_id, nome: i.nome, quantidade: i.quantidade, densidade_g: i.densidade_g }))}
          marcas={(marcas ?? []).filter((m) => ings.some((i: any) => i.insumo_id === m.insumo_id)).map((m: any) =>
            Object.fromEntries(Object.entries(m).map(([k, v]) => [k, k.startsWith("nutri_") && v != null ? Number(v) : v]))) as any}
          tabelas={(tabelas ?? []).map((t: any) => ({ ...t, versao_atual: t.receita_versao_id === r.versao_atual_id }))}
          combinacaoInicial={combinacaoInicial}
          insumos={(insumos ?? []).map((i: any) => Object.fromEntries(Object.entries(i).map(([k, v]) => [k, k.startsWith("nutri_") && v != null ? Number(v) : v]))) as any}
          massaBaseG={Number(atual.massa_base_g)}
          pesoBolinhaG={Number(atual.peso_bolinha_g)}
        />
      )}
      <div className="cartao">
        <h2>{atual ? "Editar (cria uma nova versão)" : "Cadastrar ficha técnica"}</h2>
        <p className="suave">Editar nunca altera pedidos ou lotes que já usaram a versão anterior.</p>
        <EditorReceita receitaId={r.id} tipo={r.tipo} unidadeProduto={produz?.unidade} insumos={insumos ?? []} iniciais={ings}
          peso={atual?.peso_bolinha_g ? Number(atual.peso_bolinha_g) : 180} rendimento={atual?.rendimento ? Number(atual.rendimento) : undefined} />
      </div>
      {versoes.length > 1 && (
        <div className="cartao">
          <h2>Histórico</h2>
          {versoes.map((v) => (
            <div key={v.id} className="linha-total">
              <span>v{v.numero} · {preparo ? `rende ${Number(v.rendimento).toLocaleString("pt-BR")} ${produz?.unidade ?? ""}` : `bolinha ${Number(v.peso_bolinha_g).toLocaleString("pt-BR")} g · massa ${Number(v.massa_base_g).toLocaleString("pt-BR")} g`}</span>
              <span className="suave">{formatarDataHora(v.criado_em)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
