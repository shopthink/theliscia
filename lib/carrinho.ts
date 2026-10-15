import { percentualDe } from "./dinheiro";

export interface ProdutoPreco {
  id: string;
  preco_centavos: number;
}

export interface ResumoCarrinho {
  bases: number;
  itens: number;
  taxa: number;
  total: number;
  sinal: number;
  saldo: number;
  atingiuMinimo: boolean;
  faltam: number;
}

/**
 * Prévia do carrinho no navegador. O valor cobrado é sempre recalculado no servidor
 * (public.criar_solicitacao) com os preços do banco; esta função só exibe.
 */
export function resumirCarrinho(
  produtos: ProdutoPreco[],
  quantidades: Record<string, number>,
  minimo: number,
  percentualSinal: number,
  taxaCentavos = 0,
): ResumoCarrinho {
  let bases = 0;
  let itens = 0;
  for (const p of produtos) {
    const q = Math.max(0, Math.floor(quantidades[p.id] ?? 0));
    bases += q;
    itens += q * p.preco_centavos;
  }
  const taxa = bases > 0 ? Math.max(0, taxaCentavos) : 0;
  const total = itens + taxa;
  const sinal = percentualDe(total, percentualSinal);
  return { bases, itens, taxa, total, sinal, saldo: total - sinal, atingiuMinimo: bases >= minimo, faltam: Math.max(0, minimo - bases) };
}
