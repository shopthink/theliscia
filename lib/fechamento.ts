/**
 * Fechamento do mês (regime de competência pela data de entrega do pedido).
 *
 * - Vendas: pedidos "venda" não cancelados com entrega no mês.
 * - CMV (materiais) e mão de obra: custo por base boa do lote de cada item. Itens sem lote concluído
 *   ficam como "custo não apurado" (aparecem à parte, não somam no CMV).
 * - Brindes: o mesmo custo, para pedidos "brinde". Vai para "brindes e marketing", fora do CMV.
 * - Perdas de estoque e inventário: movimentos do mês, pelo valor gravado (custo médio da marca).
 * - Tempo em compras: custo do tempo gasto comprando (valor da hora da época).
 */

export interface ItemFech {
  receita: string;
  quantidade: number;
  subtotal: number;
  lote: { status: string; unidades_boas: number | null; custo_materiais_centavos: number | null; custo_mao_obra_centavos: number | null } | null;
}
export interface PedidoFech {
  tipo: "venda" | "brinde";
  total_centavos: number;
  taxa_entrega_centavos: number;
  recebido_centavos: number;
  itens: ItemFech[];
}
export interface MovFech { tipo: string; categoria: string | null; valor_centavos: number }
export interface LoteFech { unidades_boas: number; perdas: number; custo_materiais_centavos: number }

export interface Fechamento {
  pedidos: number;
  bases: number;
  receitaProdutos: number;
  taxasEntrega: number;
  receita: number;
  recebido: number;
  aReceber: number;
  cmv: number;
  maoDeObra: number;
  basesSemCusto: number;
  brindes: { pedidos: number; bases: number; materiais: number; maoDeObra: number; semCusto: number };
  perdasEstoque: number;
  perdasPorMotivo: Record<string, number>;
  inventario: number; // positivo = sobrou, negativo = faltou
  basesPerdidas: number;
  valorBasesPerdidas: number;
  tempoCompras: number;
  margemBruta: number;
  resultado: number;
  porReceita: { receita: string; bases: number; receita_centavos: number; custo: number; semCusto: number }[];
}

function custoBase(l: ItemFech["lote"]) {
  if (!l || l.status !== "concluido" || !l.unidades_boas) return null;
  return {
    mat: Number(l.custo_materiais_centavos ?? 0) / l.unidades_boas,
    mo: Number(l.custo_mao_obra_centavos ?? 0) / l.unidades_boas,
  };
}

export function calcularFechamento(pedidos: PedidoFech[], movs: MovFech[], lotes: LoteFech[], tempoCompras: number): Fechamento {
  const f: Fechamento = {
    pedidos: 0, bases: 0, receitaProdutos: 0, taxasEntrega: 0, receita: 0, recebido: 0, aReceber: 0,
    cmv: 0, maoDeObra: 0, basesSemCusto: 0,
    brindes: { pedidos: 0, bases: 0, materiais: 0, maoDeObra: 0, semCusto: 0 },
    perdasEstoque: 0, perdasPorMotivo: {}, inventario: 0, basesPerdidas: 0, valorBasesPerdidas: 0,
    tempoCompras, margemBruta: 0, resultado: 0, porReceita: [],
  };
  const rec = new Map<string, Fechamento["porReceita"][number]>();
  for (const p of pedidos) {
    if (p.tipo === "brinde") {
      f.brindes.pedidos++;
      for (const i of p.itens) {
        f.brindes.bases += i.quantidade;
        const c = custoBase(i.lote);
        if (c) { f.brindes.materiais += c.mat * i.quantidade; f.brindes.maoDeObra += c.mo * i.quantidade; }
        else f.brindes.semCusto += i.quantidade;
      }
      continue;
    }
    f.pedidos++;
    f.taxasEntrega += p.taxa_entrega_centavos;
    f.receita += p.total_centavos;
    f.recebido += p.recebido_centavos;
    for (const i of p.itens) {
      f.bases += i.quantidade;
      f.receitaProdutos += i.subtotal;
      const r = rec.get(i.receita) ?? { receita: i.receita, bases: 0, receita_centavos: 0, custo: 0, semCusto: 0 };
      r.bases += i.quantidade;
      r.receita_centavos += i.subtotal;
      const c = custoBase(i.lote);
      if (c) { f.cmv += c.mat * i.quantidade; f.maoDeObra += c.mo * i.quantidade; r.custo += (c.mat + c.mo) * i.quantidade; }
      else { f.basesSemCusto += i.quantidade; r.semCusto += i.quantidade; }
      rec.set(i.receita, r);
    }
  }
  f.aReceber = f.receita - f.recebido;
  for (const m of movs) {
    const v = Number(m.valor_centavos);
    if (m.tipo === "perda") {
      f.perdasEstoque += -v;
      const k = m.categoria ?? "outro";
      f.perdasPorMotivo[k] = (f.perdasPorMotivo[k] ?? 0) + -v;
    } else if (m.tipo === "ajuste") f.inventario += v;
  }
  for (const l of lotes) {
    f.basesPerdidas += l.perdas;
    const feitas = l.unidades_boas + l.perdas;
    if (feitas > 0) f.valorBasesPerdidas += (Number(l.custo_materiais_centavos) / feitas) * l.perdas;
  }
  f.margemBruta = f.receita - f.cmv;
  f.resultado = f.receita - f.cmv - f.maoDeObra - f.brindes.materiais - f.brindes.maoDeObra - f.perdasEstoque + f.inventario - f.tempoCompras;
  f.porReceita = [...rec.values()].sort((a, b) => b.bases - a.bases);
  return f;
}

/** "2026-10" → primeiro e último dia do mês. */
export function intervaloMes(mes: string): { inicio: string; fim: string } {
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { inicio: `${mes}-01`, fim: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

export function mesAnterior(mes: string, n = 1): string {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function nomeMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(a, m - 1, 15)));
}
