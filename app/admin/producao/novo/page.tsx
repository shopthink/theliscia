import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirAdmin } from "@/lib/auth";
import { hojeSP } from "@/lib/datas";
import { FormNovoLote } from "./FormNovoLote";

export const metadata = { title: "Novo lote" };

export default async function NovoLote({ searchParams }: { searchParams: Promise<{ receita?: string }> }) {
  const { receita: rid } = await searchParams;
  const { supabase } = await exigirAdmin();
  const { data: receitas } = await supabase.from("receitas").select("id, nome, tipo, versao_atual_id").eq("ativa", true).order("tipo").order("nome");
  const validas = (receitas ?? []).filter((r) => r.versao_atual_id);
  if (!rid && validas.length) redirect(`/admin/producao/novo?receita=${validas[0].id}`);
  const receita = validas.find((r) => r.id === rid);

  const [{ data: r }, { data: itens }, { data: cfg }, { data: saldos }] = await Promise.all([
    supabase.from("receitas")
      .select("id, nome, tipo, produz:insumos!receitas_produz_insumo_id_fkey(nome, unidade), versao:receita_versoes!receitas_versao_atual_fk(id, numero, peso_bolinha_g, massa_base_g, rendimento, receita_versao_ingredientes(insumo_id, quantidade, insumos(nome, unidade)))")
      .eq("id", rid ?? "").maybeSingle(),
    supabase.from("pedido_itens")
      .select("id, quantidade, pedidos!inner(numero, cliente_nome, entrega_em, status_producao)")
      .eq("receita_id", rid ?? "").is("lote_id", null)
      .in("pedidos.status_producao", ["confirmado", "em_producao"]),
    supabase.from("configuracoes").select("semola_g_por_base, saco_vacuo_por_base, etiqueta_por_base, molho_g_por_base").single(),
    supabase.from("estoque_saldos").select("insumo_id, marca_id, quantidade, marcas(em_uso)"),
  ]);
  // Estoque da marca em uso de cada insumo (sem marca em uso: o total do insumo)
  const comEmUso = new Set((saldos ?? []).filter((x: any) => x.marcas?.em_uso).map((x) => x.insumo_id));
  const estoqueLote: Record<string, number> = {};
  for (const x of (saldos ?? []) as any[]) {
    if (comEmUso.has(x.insumo_id) && !x.marcas?.em_uso) continue;
    estoqueLote[x.insumo_id] = (estoqueLote[x.insumo_id] ?? 0) + Number(x.quantidade);
  }
  const { data: auxiliares } = await supabase.from("insumos").select("id, nome, unidade, uso_auxiliar").not("uso_auxiliar", "is", null);

  return (
    <>
      <div className="cabecalho">
        <div>
          <Link href="/admin/producao" className="suave">← Produção</Link>
          <h1>Novo lote</h1>
        </div>
      </div>
      <div className="cartao">
        <div className="campo" style={{ marginBottom: 0 }}>
          <label>Receita</label>
          <div className="acoes">
            {validas.map((x) => (
              <Link key={x.id} href={`/admin/producao/novo?receita=${x.id}`} className={`botao pequeno ${x.id === rid ? "" : "contorno"}`}>{x.nome}</Link>
            ))}
          </div>
        </div>
      </div>
      {!receita || !r ? <div className="cartao vazio">Escolha uma receita com ficha técnica.</div> : (
        <FormNovoLote
          key={r.id}
          receita={r as any}
          itens={((itens ?? []) as any[]).sort((a, b) => a.pedidos.entrega_em.localeCompare(b.pedidos.entrega_em) || a.pedidos.numero - b.pedidos.numero)}
          aux={Object.fromEntries(Object.entries(cfg ?? {}).map(([k, v]) => [k, Number(v)]))}
          auxiliares={auxiliares ?? []}
          estoque={estoqueLote}
          hoje={hojeSP()}
        />
      )}
    </>
  );
}
