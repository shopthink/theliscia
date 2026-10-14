/**
 * Lista de compras: necessidade dos pedidos confirmados ainda não produzidos, menos o estoque.
 * Usa a versão de receita gravada em cada item do pedido.
 */

export interface ItemPedidoParaProducao {
  quantidade: number; // bases
  peso_bolinha_g: number;
  massa_base_g: number;
  ingredientes: { insumo_id: string; quantidade: number }[];
}

export interface PedidoParaProducao {
  itens: ItemPedidoParaProducao[];
}

export interface ConsumoAuxiliar {
  semola_g_por_base: number;
  saco_vacuo_por_base: number;
  etiqueta_por_base: number;
  molho_ml_por_base: number;
  sacola_por_pedido: number;
}

export interface InsumoLista {
  id: string;
  nome: string;
  unidade: string;
  uso_auxiliar: string | null;
  entra_lista_compras: boolean;
  ativo: boolean;
}

export interface LinhaLista {
  insumo: InsumoLista;
  necessidade: number;
  estoque: number;
  comprar: number;
}

export function calcularNecessidade(pedidos: PedidoParaProducao[], aux: ConsumoAuxiliar, insumos: InsumoLista[]) {
  const nec = new Map<string, number>();
  const somar = (id: string | undefined, q: number) => {
    if (!id || !(q > 0)) return;
    nec.set(id, (nec.get(id) ?? 0) + q);
  };
  const porUso = (uso: string) => insumos.find((i) => i.uso_auxiliar === uso)?.id;
  let bases = 0;
  for (const p of pedidos) {
    let basesPedido = 0;
    for (const it of p.itens) {
      basesPedido += it.quantidade;
      const fator = (it.quantidade * it.peso_bolinha_g) / it.massa_base_g;
      for (const ing of it.ingredientes) somar(ing.insumo_id, ing.quantidade * fator);
    }
    bases += basesPedido;
    if (basesPedido > 0) somar(porUso("sacola"), aux.sacola_por_pedido);
  }
  somar(porUso("semola"), bases * aux.semola_g_por_base);
  somar(porUso("saco_vacuo"), bases * aux.saco_vacuo_por_base);
  somar(porUso("etiqueta"), bases * aux.etiqueta_por_base);
  somar(porUso("molho"), bases * aux.molho_ml_por_base);
  return { necessidade: nec, bases };
}

export function montarLista(
  pedidos: PedidoParaProducao[],
  aux: ConsumoAuxiliar,
  insumos: InsumoLista[],
  saldos: Record<string, number>,
): { linhas: LinhaLista[]; bases: number } {
  const { necessidade, bases } = calcularNecessidade(pedidos, aux, insumos);
  const linhas = insumos
    .filter((i) => i.ativo && (necessidade.has(i.id) || (saldos[i.id] ?? 0) !== 0))
    .map((i) => {
      const n = arred(necessidade.get(i.id) ?? 0);
      const e = arred(saldos[i.id] ?? 0);
      return { insumo: i, necessidade: n, estoque: e, comprar: i.entra_lista_compras ? arred(Math.max(0, n - Math.max(0, e))) : 0 };
    })
    .sort((a, b) => b.comprar - a.comprar || a.insumo.nome.localeCompare(b.insumo.nome));
  return { linhas, bases };
}

function arred(n: number) {
  return Math.round(n * 10) / 10;
}
