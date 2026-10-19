import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirAdmin } from "@/lib/auth";
import { formatarBRL } from "@/lib/dinheiro";
import { formatarData, formatarDataHora, formatarMinutos } from "@/lib/datas";
import { codigoLote, STATUS_LOTE } from "@/lib/producao";
import { PainelLote } from "./PainelLote";

export const metadata = { title: "Lote" };
export const dynamic = "force-dynamic";

export default async function Lote({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ criado?: string }> }) {
  const { id } = await params;
  const { criado } = await searchParams;
  const { supabase } = await exigirAdmin();
  const [{ data: l }, { data: abertaOutra }, { data: insumos }, { data: saldos }] = await Promise.all([
    supabase.from("lotes")
      .select("*, receitas(nome, produz:insumos!receitas_produz_insumo_id_fkey(nome, unidade)), receita_versoes(numero), lote_sessoes(id, etapa, inicio, fim, manual), lote_esperas(id, tipo, inicio, fim, alvo_min, lembrete_min, lembrete_feito_em), lote_consumos(insumo_id, marca_id, quantidade_prevista, quantidade_real, custo_unitario_centavos, custo_total_centavos, insumos(nome, unidade), marcas(nome)), pedido_itens(id, quantidade, nome, pedidos(id, numero, cliente_nome, entrega_em))")
      .eq("id", id).maybeSingle(),
    supabase.from("lote_sessoes").select("lote_id, etapa, lotes(numero)").is("fim", null).neq("lote_id", id).maybeSingle(),
    supabase.from("insumos").select("id, nome, unidade, marcas(id, nome, em_uso, ativo)").eq("ativo", true).order("nome"),
    supabase.from("estoque_saldos").select("insumo_id, marca_id, quantidade"),
  ]);
  if (!l) notFound();
  const [rot, cls] = STATUS_LOTE[l.status];
  const produz = (l.receitas as any)?.produz as { nome: string; unidade: string } | null;
  const concluido = l.status === "concluido";
  const pedidos = new Map<string, { numero: number; cliente: string; entrega: string; bases: number }>();
  for (const it of (l.pedido_itens as any[]) ?? []) {
    const p = pedidos.get(it.pedidos.id) ?? { numero: it.pedidos.numero, cliente: it.pedidos.cliente_nome, entrega: it.pedidos.entrega_em, bases: 0 };
    p.bases += it.quantidade;
    pedidos.set(it.pedidos.id, p);
  }

  return (
    <>
      <div className="cabecalho">
        <div>
          <Link href="/admin/producao" className="suave">← Produção</Link>
          <h1>{codigoLote(l.numero)} · {(l.receitas as any)?.nome} <span className={`selo ${cls}`}>{rot}</span></h1>
          <p className="suave" style={{ margin: 0 }}>
            {l.tipo === "base"
              ? `${l.bases_pedidos + l.bases_extras} ${l.bases_pedidos + l.bases_extras === 1 ? "base" : "bases"} (${l.bases_pedidos} de pedidos + ${l.bases_extras} ${l.bases_extras === 1 ? "extra" : "extras"}) · bolinha ${Number(l.peso_bolinha_g)} g · ${Number(l.massa_planejada_g).toLocaleString("pt-BR")} g de massa`
              : `${Number(l.quantidade_planejada).toLocaleString("pt-BR")} ${produz?.unidade} de ${produz?.nome}`}
            {" · "}receita v{(l.receita_versoes as any)?.numero} · previsto para {formatarData(l.data_planejada)}
          </p>
        </div>
      </div>
      {l.tipo === "base" && l.status !== "cancelado" && (
        <div className="acoes" style={{ marginBottom: "1rem" }}>
          <Link className="botao contorno" href={`/admin/etiquetas?lote=${l.id}`}>🏷 Imprimir etiquetas do lote</Link>
        </div>
      )}
      {criado && l.status === "planejado" && <div className="aviso ok">Lote criado. Quando começar, aperte play na etapa.</div>}
      {l.status === "cancelado" && <div className="aviso erro">Cancelado em {formatarDataHora(l.cancelado_em)}: {l.cancelado_motivo}</div>}

      {concluido && (
        <div className="cartao" style={{ borderColor: "var(--ok)" }}>
          <h2>Resultado</h2>
          <div className="cartoes" style={{ marginBottom: 0 }}>
            <div><div className="caixa-alta suave">{l.tipo === "base" ? "Bases boas" : "Produzido"}</div><div className="indicador num">{l.tipo === "base" ? l.unidades_boas : `${Number(l.quantidade_produzida).toLocaleString("pt-BR")} ${produz?.unidade}`}</div>{l.tipo === "base" && <small>{l.perdas} {l.perdas === 1 ? "perda" : "perdas"}</small>}</div>
            <div><div className="caixa-alta suave">Trabalho ativo</div><div className="indicador num">{formatarMinutos(Number(l.minutos_ativos))}</div><small>a {formatarBRL(l.valor_hora_centavos)}/h</small></div>
            <div><div className="caixa-alta suave">Custo do lote</div><div className="indicador num">{formatarBRL(Math.round(Number(l.custo_total_centavos)))}</div><small>materiais {formatarBRL(Math.round(Number(l.custo_materiais_centavos)))} + mão de obra {formatarBRL(l.custo_mao_obra_centavos)}</small></div>
            <div><div className="caixa-alta suave">{l.tipo === "base" ? "Custo por base boa" : `Custo por ${produz?.unidade === "un" ? "un" : produz?.unidade === "ml" ? "L" : "kg"}`}</div>
              <div className="indicador num">{l.tipo === "base" || produz?.unidade === "un" ? formatarBRL(Math.round(Number(l.custo_por_unidade_centavos))) : formatarBRL(Math.round(Number(l.custo_por_unidade_centavos) * 1000))}</div>
              {l.tipo === "preparo" && <small>no estoque entra só o custo dos materiais</small>}
            </div>
          </div>
        </div>
      )}

      <PainelLote
        lote={{
          id: l.id, numero: l.numero, tipo: l.tipo, status: l.status, versao: l.versao,
          unidades_boas: l.unidades_boas, perdas: l.perdas, quantidade_produzida: l.quantidade_produzida != null ? Number(l.quantidade_produzida) : null,
          observacoes: l.observacoes, produzido_em: l.produzido_em, assado_em: l.assado_em, congelado_em: l.congelado_em,
          bases_pedidos: l.bases_pedidos, unidadeProduto: produz?.unidade ?? null,
        }}
        sessoes={((l.lote_sessoes as any[]) ?? []).sort((a, b) => a.inicio.localeCompare(b.inicio))}
        esperas={((l.lote_esperas as any[]) ?? []).sort((a, b) => a.inicio.localeCompare(b.inicio))}
        consumos={((l.lote_consumos as any[]) ?? []).map((c) => ({
          insumo_id: c.insumo_id, nome: c.insumos.nome, unidade: c.insumos.unidade, marca_id: c.marca_id ?? null, marca_nome: c.marcas?.nome ?? null,
          prevista: Number(c.quantidade_prevista), real: Number(c.quantidade_real),
          custoUnit: c.custo_unitario_centavos != null ? Number(c.custo_unitario_centavos) : null,
          custoTotal: c.custo_total_centavos != null ? Number(c.custo_total_centavos) : null,
        })).sort((a, b) => b.prevista - a.prevista)}
        insumos={(insumos ?? []).map((i: any) => ({ ...i, marcas: (i.marcas ?? []).filter((m: any) => m.ativo) }))}
        estoque={Object.fromEntries((saldos ?? []).map((s) => [`${s.insumo_id}|${s.marca_id ?? ""}`, Number(s.quantidade)]))}
        abertaOutra={abertaOutra ? { etapa: abertaOutra.etapa, numero: (abertaOutra as any).lotes.numero, lote_id: abertaOutra.lote_id } : null}
      />

      {pedidos.size > 0 && (
        <div className="cartao">
          <h2>Pedidos deste lote</h2>
          {[...pedidos].map(([pid, p]) => (
            <div key={pid} className="linha-total">
              <span><Link href={`/admin/pedidos/${pid}`}>#{String(p.numero).padStart(4, "0")}</Link> · {p.cliente} · entrega {formatarData(p.entrega)}</span>
              <span className="num">{p.bases} bases</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
