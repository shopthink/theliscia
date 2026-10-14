import { percentualDe } from "./dinheiro";

export interface ProdutoPreco {
  id: string;
  preco_centavos: number;
}

export interface ResumoCarrinho {
  bases: number;
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
): ResumoCarrinho {
  let bases = 0;
  let total = 0;
  for (const p of produtos) {
    const q = Math.max(0, Math.floor(quantidades[p.id] ?? 0));
    bases += q;
    total += q * p.preco_centavos;
  }
  const sinal = percentualDe(total, percentualSinal);
  return { bases, total, sinal, saldo: total - sinal, atingiuMinimo: bases >= minimo, faltam: Math.max(0, minimo - bases) };
}
