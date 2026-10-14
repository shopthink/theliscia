export interface IngredienteReceita {
  insumo_id: string;
  nome?: string;
  unidade?: string;
  quantidade: number;
  densidade_g: number; // gramas por unidade (1 para g, água e cerveja; 0,91 para azeite)
}

/** Massa total estimada da receita-base, em gramas. */
export function massaBase(ingredientes: IngredienteReceita[]): number {
  return arred(ingredientes.reduce((s, i) => s + i.quantidade * i.densidade_g, 0), 3);
}

/** Modo 1: quantidade de bases × peso da bolinha → ingredientes. */
export function dimensionarPorBases(ingredientes: IngredienteReceita[], bases: number, pesoBolinhaG: number) {
  const massaNecessaria = bases * pesoBolinhaG;
  const fator = massaNecessaria / massaBase(ingredientes);
  return {
    massaNecessaria,
    fator,
    ingredientes: ingredientes.map((i) => ({ ...i, quantidade: arred(i.quantidade * fator, 1) })),
  };
}

/** Modo 2: farinha disponível e número de divisões → peso de cada bolinha, sem sobras. */
export function dimensionarPorFarinha(ingredientes: IngredienteReceita[], farinhaG: number, divisoes: number, farinhaId: string) {
  const farinhaBase = ingredientes.find((i) => i.insumo_id === farinhaId)?.quantidade;
  if (!farinhaBase) throw new Error("A receita não tem farinha.");
  const fator = farinhaG / farinhaBase;
  const massaTotal = massaBase(ingredientes) * fator;
  return {
    fator,
    massaTotal: arred(massaTotal, 1),
    pesoBolinha: arred(massaTotal / divisoes, 1),
    ingredientes: ingredientes.map((i) => ({ ...i, quantidade: arred(i.quantidade * fator, 1) })),
  };
}

/** Rendimento teórico por kg de farinha, antes das perdas. */
export function basesPorKgFarinha(ingredientes: IngredienteReceita[], pesoBolinhaG: number, farinhaId: string) {
  const farinhaBase = ingredientes.find((i) => i.insumo_id === farinhaId)?.quantidade;
  if (!farinhaBase) return null;
  return arred((massaBase(ingredientes) * (1000 / farinhaBase)) / pesoBolinhaG, 2);
}

function arred(n: number, casas: number) {
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}
