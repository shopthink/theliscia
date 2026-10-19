import Link from "next/link";
import { exigirAdmin } from "@/lib/auth";
import { formatarData } from "@/lib/datas";
import { codigoLote } from "@/lib/producao";
import { BotaoImprimir } from "@/components/BotaoImprimir";
import { localEntrega } from "@/lib/condominios";
import { NUTRIENTES, alertasFrontais, formatarValor, percentualVD, porcao, type Tabela } from "@/lib/nutricao";
import { chaveMarcas } from "@/lib/marcas";

export const metadata = { title: "Etiquetas" };
export const dynamic = "force-dynamic";

interface ReceitaRotulo {
  id: string; nome: string; rotulo_nome: string | null; rotulo_alergenicos: string | null;
  rotulo_conservacao: string | null; rotulo_preparo: string | null; validade_dias: number | null;
  peso_assado_g: number | null; porcao_g: number | null; porcao_medida: string | null;
}
interface Etiqueta {
  receita: ReceitaRotulo;
  versaoId: string;
  marcas: Record<string, string | null>;   // marca de cada insumo usada (lote) ou em uso (sem lote)
  tabela?: { nutricao: Tabela; ingredientes: string } | null;
  lote: { numero: number; produzido_em: string | null; assado_em: string | null } | null;
  pedido: { numero: number; cliente: string; local: string | null } | null;
  indice: number; total: number;
}

const CAMPOS_RECEITA = "id, nome, rotulo_nome, rotulo_alergenicos, rotulo_conservacao, rotulo_preparo, validade_dias, peso_assado_g, porcao_g, porcao_medida";

/** Na etiqueta só vai condomínio e unidade (endereço completo fica fora por privacidade). */
function localCurto(p: { modalidade: string; condominio_nome?: string | null; bloco?: string | null; apto?: string | null }) {
  if (p.condominio_nome) return localEntrega(p);
  return p.modalidade === "retirada" ? "Retirada" : null;
}

function somarDias(iso: string, dias: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function marcasDoLote(consumos: { insumo_id: string; marca_id: string | null }[] | null | undefined) {
  return Object.fromEntries((consumos ?? []).map((c) => [c.insumo_id, c.marca_id]));
}

export default async function Etiquetas({ searchParams }: { searchParams: Promise<{ lote?: string; pedido?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await exigirAdmin();
  const { data: emUsoLista } = await supabase.from("marcas").select("id, insumo_id").eq("em_uso", true);
  const emUso: Record<string, string | null> = Object.fromEntries((emUsoLista ?? []).map((m) => [m.insumo_id, m.id]));
  const { data: cfg } = await supabase.from("configuracoes").select("nome_comercial, rotulo_fabricante, rotulo_documento, rotulo_endereco, rotulo_contato").single();

  let titulo = "";
  let voltar = "/admin";
  const etiquetas: Etiqueta[] = [];

  if (sp.lote) {
    const { data: l } = await supabase.from("lotes")
      .select(`id, numero, tipo, status, produzido_em, assado_em, bases_pedidos, bases_extras, unidades_boas, receita_versao_id, receitas(${CAMPOS_RECEITA}), lote_consumos(insumo_id, marca_id), pedido_itens(quantidade, pedidos(numero, cliente_nome, modalidade, condominio_nome, bloco, apto))`)
      .eq("id", sp.lote).maybeSingle();
    if (l && l.tipo === "base") {
      titulo = `Lote ${codigoLote(l.numero)}`;
      voltar = `/admin/producao/${l.id}`;
      const receita = l.receitas as unknown as ReceitaRotulo;
      const lote = { numero: l.numero, produzido_em: l.produzido_em, assado_em: l.assado_em };
      const base = { receita, versaoId: l.receita_versao_id, marcas: marcasDoLote(l.lote_consumos as any[]) };
      const itens = ((l.pedido_itens as any[]) ?? []).sort((a, b) => a.pedidos.numero - b.pedidos.numero);
      for (const it of itens) for (let k = 1; k <= it.quantidade; k++)
        etiquetas.push({ ...base, lote, pedido: { numero: it.pedidos.numero, cliente: it.pedidos.cliente_nome, local: localCurto(it.pedidos) }, indice: k, total: it.quantidade });
      const totalLote = l.status === "concluido" && l.unidades_boas != null ? l.unidades_boas : l.bases_pedidos + l.bases_extras;
      const extras = Math.max(0, totalLote - itens.reduce((s, i) => s + i.quantidade, 0));
      for (let k = 1; k <= extras; k++) etiquetas.push({ ...base, lote, pedido: null, indice: k, total: extras });
    }
  } else if (sp.pedido) {
    const { data: p } = await supabase.from("pedidos")
      .select(`id, numero, cliente_nome, modalidade, condominio_nome, bloco, apto, pedido_itens(quantidade, receita_versao_id, receitas(${CAMPOS_RECEITA}), lotes(numero, produzido_em, assado_em, receita_versao_id, lote_consumos(insumo_id, marca_id)))`)
      .eq("id", sp.pedido).maybeSingle();
    if (p) {
      titulo = `Pedido #${String(p.numero).padStart(4, "0")}`;
      voltar = `/admin/pedidos/${p.id}`;
      const total = ((p.pedido_itens as any[]) ?? []).reduce((s, i) => s + i.quantidade, 0);
      let n = 0;
      for (const it of (p.pedido_itens as any[]) ?? [])
        for (let k = 1; k <= it.quantidade; k++)
          etiquetas.push({
            receita: it.receitas, lote: it.lotes, versaoId: it.lotes?.receita_versao_id ?? it.receita_versao_id,
            marcas: it.lotes ? marcasDoLote(it.lotes.lote_consumos) : emUso,
            pedido: { numero: p.numero, cliente: p.cliente_nome, local: localCurto(p) }, indice: ++n, total,
          });
    }
  }

  // Cada etiqueta usa a tabela validada da combinação de marcas dos ingredientes da receita
  const versoes = [...new Set(etiquetas.map((e) => e.versaoId))];
  const receitaIds = [...new Set(etiquetas.map((e) => e.receita.id))];
  const [{ data: ingVersoes }, { data: tabelas }, { data: nomesMarcas }] = await Promise.all([
    versoes.length ? supabase.from("receita_versao_ingredientes").select("receita_versao_id, insumo_id, insumos(nome)").in("receita_versao_id", versoes) : Promise.resolve({ data: [] as any[] }),
    receitaIds.length ? supabase.from("receita_tabelas").select("receita_id, chave, nutricao, ingredientes").in("receita_id", receitaIds) : Promise.resolve({ data: [] as any[] }),
    supabase.from("marcas").select("id, nome"),
  ]);
  const faltando = new Map<string, { receita: ReceitaRotulo; combo: Record<string, string | null>; descricao: string }>();
  for (const e of etiquetas) {
    const ings = (ingVersoes ?? []).filter((g: any) => g.receita_versao_id === e.versaoId);
    const combo = Object.fromEntries(ings.map((g: any) => [g.insumo_id, e.marcas[g.insumo_id] ?? null]));
    const chave = chaveMarcas(combo);
    const t = (tabelas ?? []).find((x: any) => x.receita_id === e.receita.id && x.chave === chave);
    e.tabela = t ? { nutricao: t.nutricao, ingredientes: t.ingredientes } : null;
    if (!t && !faltando.has(`${e.receita.id}|${chave}`)) {
      const descricao = ings.map((g: any) => `${g.insumos?.nome}: ${(nomesMarcas ?? []).find((m) => m.id === combo[g.insumo_id])?.nome ?? "sem marca"}`).join(" · ");
      faltando.set(`${e.receita.id}|${chave}`, { receita: e.receita, combo, descricao });
    }
  }

  const receitas = [...new Map(etiquetas.map((e) => [e.receita.id, e.receita])).values()];
  const bloqueadas = receitas.filter((r) => !r.peso_assado_g || !r.porcao_g);
  const semLote = etiquetas.some((e) => !e.lote);
  const semForno = etiquetas.some((e) => e.lote && !e.lote.assado_em);
  const imprimiveis = etiquetas.filter((e) => !bloqueadas.includes(e.receita) && e.tabela);

  return (
    <>
      {/* Tamanho do papel só nesta página: as outras telas imprimem em A4 */}
      <style>{"@media print { @page { size: 100mm 150mm; margin: 0; } }"}</style>
      <div className="nao-imprimir">
        <div className="cabecalho">
          <div>
            <Link href={voltar} className="suave">← Voltar</Link>
            <h1>Etiquetas {titulo && `· ${titulo}`}</h1>
          </div>
          {imprimiveis.length > 0 && <BotaoImprimir rotulo={`Imprimir ${imprimiveis.length} ${imprimiveis.length === 1 ? "etiqueta" : "etiquetas"}`} />}
        </div>
        {!etiquetas.length && <div className="cartao vazio">Nada para imprimir. Abra pelas telas de lote ou de pedido.</div>}
        {bloqueadas.map((r) => (
          <div key={r.id} className="aviso erro">
            <strong>{r.nome}</strong>: complete peso assado e porção antes de imprimir.{" "}
            <Link href={`/admin/receitas/${r.id}`}>Abrir receita</Link>
          </div>
        ))}
        {[...faltando.values()].filter((f) => !bloqueadas.includes(f.receita)).map((f) => (
          <div key={f.descricao + f.receita.id} className="aviso erro">
            <strong>{f.receita.nome}</strong>: a combinação de marcas deste lote ainda não tem tabela validada ({f.descricao}).{" "}
            <Link href={`/admin/receitas/${f.receita.id}?marcas=${encodeURIComponent(JSON.stringify(f.combo))}#tabela`}>Validar esta combinação</Link>
          </div>
        ))}
        {semLote && <div className="aviso alerta">Há bases deste pedido que ainda não estão em nenhum lote: sem número de lote e datas.</div>}
        {semForno && <div className="aviso alerta">O lote ainda não foi ao forno: datas de produção e validade ficam em branco.</div>}
        {imprimiveis.length > 0 && (
          <div className="aviso info">
            Na janela de impressão: escolha a <strong>Zebra</strong>, papel <strong>100 × 150 mm</strong>, margens <strong>nenhuma</strong> e escala <strong>100%</strong>.
            Uma etiqueta por base.
          </div>
        )}
      </div>

      <div className="etiquetas">
        {imprimiveis.map((e, i) => <EtiquetaBase key={i} e={e} cfg={cfg} />)}
      </div>
    </>
  );
}

function EtiquetaBase({ e, cfg }: { e: Etiqueta; cfg: any }) {
  const r = e.receita;
  const t = e.tabela!.nutricao;
  const p = porcao(t, Number(r.porcao_g));
  const porcoes = Math.max(1, Math.round((Number(r.peso_assado_g) / Number(r.porcao_g)) * 10) / 10);
  const alertas = alertasFrontais(t);
  const validade = e.lote?.assado_em && r.validade_dias ? somarDias(e.lote.assado_em, r.validade_dias) : null;

  return (
    <section className="etiqueta">
      <header className="et-topo">
        <img src="/marca/logo-preto.svg" alt="The Liscia Pizzas" className="et-logo" />
        {alertas.length > 0 && (
          <div className="et-lupa" aria-label={`Alto em ${alertas.join(", ")}`}>
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="10" cy="10" r="6.5" fill="none" stroke="#fff" strokeWidth="2.6" /><line x1="15" y1="15" x2="21.5" y2="21.5" stroke="#fff" strokeWidth="3" strokeLinecap="round" /></svg>
            <div><div>ALTO EM</div>{alertas.map((a) => <div key={a}>{a}</div>)}</div>
          </div>
        )}
      </header>

      <div className="et-produto">{r.rotulo_nome ?? r.nome}</div>
      <div className="et-peso">PESO LÍQUIDO: {Number(r.peso_assado_g).toLocaleString("pt-BR")} g</div>

      <div className="et-cliente">
        {e.pedido ? (
          <>
            <div className="et-cliente-nome">{e.pedido.cliente}</div>
            {e.pedido.local && <div className="et-local">{e.pedido.local}</div>}
            <div>Pedido #{String(e.pedido.numero).padStart(4, "0")} · base {e.indice} de {e.total}</div>
          </>
        ) : <div className="et-cliente-nome">Estoque</div>}
      </div>

      <div className="et-datas">
        <div><span>Lote</span><strong>{e.lote ? codigoLote(e.lote.numero) : "—"}</strong></div>
        <div><span>Produção</span><strong>{formatarData(e.lote?.produzido_em)}</strong></div>
        <div><span>Assada em</span><strong>{formatarData(e.lote?.assado_em)}</strong></div>
        <div><span>Validade</span><strong>{formatarData(validade)}</strong></div>
      </div>

      <p className="et-texto"><strong>INGREDIENTES:</strong> {e.tabela!.ingredientes}</p>
      {r.rotulo_alergenicos && <p className="et-alergenicos">{r.rotulo_alergenicos}</p>}

      <table className="et-tabela">
        <caption>
          <strong>INFORMAÇÃO NUTRICIONAL</strong>
          <span>Porções por embalagem: {porcoes.toLocaleString("pt-BR")} · Porção: {Number(r.porcao_g).toLocaleString("pt-BR")} g{r.porcao_medida ? ` (${r.porcao_medida})` : ""}</span>
        </caption>
        <thead><tr><th></th><th>100 g</th><th>{Number(r.porcao_g).toLocaleString("pt-BR")} g</th><th>%VD*</th></tr></thead>
        <tbody>
          {NUTRIENTES.map((n) => {
            const vd = percentualVD(n.chave, p[n.chave]);
            return (
              <tr key={n.chave} className={"recuo" in n ? "recuo" : undefined}>
                <td>{n.rotulo} ({n.unidade})</td>
                <td>{formatarValor(n.chave, t[n.chave])}</td>
                <td>{formatarValor(n.chave, p[n.chave])}</td>
                <td>{vd != null ? vd : "**"}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot><tr><td colSpan={4}>*Percentual de valores diários fornecidos pela porção. **VD não estabelecido.</td></tr></tfoot>
      </table>

      {r.rotulo_conservacao && <p className="et-texto"><strong>CONSERVAÇÃO:</strong> {r.rotulo_conservacao}</p>}
      {r.rotulo_preparo && <p className="et-texto"><strong>MODO DE PREPARO:</strong> {r.rotulo_preparo}</p>}

      <footer className="et-rodape">
        {cfg?.rotulo_fabricante ? `Produzido por ${cfg.rotulo_fabricante}` : cfg?.nome_comercial}
        {cfg?.rotulo_documento && ` · ${cfg.rotulo_documento}`}
        {cfg?.rotulo_endereco && ` · ${cfg.rotulo_endereco}`}
        {cfg?.rotulo_contato && ` · SAC ${cfg.rotulo_contato}`}
      </footer>
    </section>
  );
}
