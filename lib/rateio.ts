/**
 * Rateio de frete, taxas e desconto entre os itens de uma compra (fase 2), em centavos.
 * Distribui o resíduo de arredondamento para que a soma bata exatamente com o total,
 * pelo método do maior resto. Nunca deixa um item com custo negativo.
 */
export function ratear(valores: number[], extras: number): number[] {
  if (valores.some((v) => !Number.isInteger(v) || v < 0)) throw new Error("Valores devem ser centavos não negativos.");
  if (!Number.isInteger(extras)) throw new Error("Extras devem estar em centavos.");
  const subtotal = valores.reduce((a, b) => a + b, 0);
  if (subtotal + extras < 0) throw new Error("O desconto é maior que a compra.");
  if (valores.length === 0) return [];
  if (subtotal === 0) {
    // Sem base para proporção: divide igualmente
    return ratear(valores.map(() => 1), extras).map((v) => v - 1);
  }
  const brutos = valores.map((v) => (v * extras) / subtotal);
  const parcelas = brutos.map((b) => Math.floor(b));
  let resto = extras - parcelas.reduce((a, b) => a + b, 0);
  const ordem = brutos.map((b, i) => ({ i, frac: b - Math.floor(b) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; resto > 0; k = (k + 1) % ordem.length, resto--) parcelas[ordem[k].i] += 1;
  const finais = valores.map((v, i) => v + parcelas[i]);
  // Se algum ficou negativo (desconto grande), devolve a diferença aos demais
  let deficit = 0;
  for (let i = 0; i < finais.length; i++) if (finais[i] < 0) { deficit += -finais[i]; finais[i] = 0; }
  for (let i = 0; deficit > 0 && i < finais.length; i++) {
    const tira = Math.min(finais[i], deficit);
    finais[i] -= tira;
    deficit -= tira;
  }
  return finais;
}

export const FATOR_UNIDADE: Record<string, { base: "g" | "ml" | "un"; fator: number }> = {
  g: { base: "g", fator: 1 },
  kg: { base: "g", fator: 1000 },
  ml: { base: "ml", fator: 1 },
  l: { base: "ml", fator: 1000 },
  L: { base: "ml", fator: 1000 },
  un: { base: "un", fator: 1 },
};

/** 2 pacotes de 1 kg → 2000 g */
export function normalizarQuantidade(pacotes: number, conteudo: number, unidade: string) {
  const u = FATOR_UNIDADE[unidade];
  if (!u) throw new Error(`Unidade desconhecida: ${unidade}`);
  return { quantidade: Math.round(pacotes * conteudo * u.fator * 1000) / 1000, unidade: u.base };
}

/** Custo do tempo de compra, contado uma única vez por compra. */
export function custoTempo(minutos: number, valorHoraCentavos: number): number {
  return Math.round((minutos * valorHoraCentavos) / 60);
}
