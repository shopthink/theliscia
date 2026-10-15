/**
 * Tabela nutricional estimada a partir da ficha técnica.
 *
 * Os insumos guardam a composição por 100 g (ou 100 ml, conforme a unidade).
 * A base crua tem peso_bolinha_g; depois de assada pesa peso_assado_g (perde água).
 * Os nutrientes da base não mudam no forno (aproximação), só a massa: por isso
 * o valor por 100 g do produto assado = nutrientes de uma base × 100 / peso_assado_g.
 *
 * É uma estimativa para o proprietário VALIDAR (com nutricionista ou laudo). A etiqueta
 * imprime apenas a tabela validada.
 */

export const NUTRIENTES = [
  { chave: "kcal", rotulo: "Valor energético", unidade: "kcal", vd: 2000 },
  { chave: "carboidratos_g", rotulo: "Carboidratos totais", unidade: "g", vd: 300 },
  { chave: "acucares_totais_g", rotulo: "Açúcares totais", unidade: "g", vd: null, recuo: 1 },
  { chave: "acucares_adic_g", rotulo: "Açúcares adicionados", unidade: "g", vd: 50, recuo: 1 },
  { chave: "proteinas_g", rotulo: "Proteínas", unidade: "g", vd: 50 },
  { chave: "gorduras_g", rotulo: "Gorduras totais", unidade: "g", vd: 65 },
  { chave: "saturadas_g", rotulo: "Gorduras saturadas", unidade: "g", vd: 20, recuo: 1 },
  { chave: "trans_g", rotulo: "Gorduras trans", unidade: "g", vd: null, recuo: 1 },
  { chave: "fibras_g", rotulo: "Fibras alimentares", unidade: "g", vd: 25 },
  { chave: "sodio_mg", rotulo: "Sódio", unidade: "mg", vd: 2000 },
] as const;

export type ChaveNutriente = (typeof NUTRIENTES)[number]["chave"];
export type Tabela = Record<ChaveNutriente, number>;

export interface InsumoNutri {
  id: string;
  nome: string;
  nutri_kcal: number | null;
  nutri_carboidratos_g: number | null;
  nutri_acucares_totais_g: number | null;
  nutri_acucares_adic_g: number | null;
  nutri_proteinas_g: number | null;
  nutri_gorduras_g: number | null;
  nutri_saturadas_g: number | null;
  nutri_trans_g: number | null;
  nutri_fibras_g: number | null;
  nutri_sodio_mg: number | null;
}

export interface IngredienteNutri { insumo_id: string; quantidade: number }

export function tabelaVazia(): Tabela {
  return Object.fromEntries(NUTRIENTES.map((n) => [n.chave, 0])) as Tabela;
}

/**
 * Calcula a tabela por 100 g do produto assado.
 * Retorna também os insumos sem dados (para avisar) — eles entram como zero.
 */
export function calcularPor100g(
  ingredientes: IngredienteNutri[],
  insumos: InsumoNutri[],
  massaBaseG: number,
  pesoBolinhaG: number,
  pesoAssadoG: number,
): { tabela: Tabela; semDados: string[] } {
  const total = tabelaVazia();
  const semDados: string[] = [];
  for (const ing of ingredientes) {
    const ins = insumos.find((i) => i.id === ing.insumo_id);
    if (!ins) continue;
    if (ins.nutri_kcal == null) {
      semDados.push(ins.nome);
      continue;
    }
    const f = Number(ing.quantidade) / 100;
    for (const n of NUTRIENTES) total[n.chave] += Number((ins as any)[`nutri_${n.chave}`] ?? 0) * f;
  }
  const porBase = pesoBolinhaG / massaBaseG;
  const fator = (porBase * 100) / pesoAssadoG;
  const tabela = Object.fromEntries(NUTRIENTES.map((n) => [n.chave, total[n.chave] * fator])) as Tabela;
  return { tabela, semDados };
}

/** Arredondamento de exibição: kcal e mg inteiros; gramas com 1 casa abaixo de 10, inteiro acima. */
export function arredondar(chave: ChaveNutriente, v: number): number {
  if (chave === "kcal" || chave === "sodio_mg") return Math.round(v);
  return v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
}

export function formatarValor(chave: ChaveNutriente, v: number): string {
  return arredondar(chave, v).toLocaleString("pt-BR");
}

export function porcao(tabela: Tabela, porcaoG: number): Tabela {
  return Object.fromEntries(NUTRIENTES.map((n) => [n.chave, (tabela[n.chave] * porcaoG) / 100])) as Tabela;
}

export function percentualVD(chave: ChaveNutriente, valorPorcao: number): number | null {
  const n = NUTRIENTES.find((x) => x.chave === chave)!;
  if (!n.vd) return null;
  return Math.round((valorPorcao / n.vd) * 100);
}

/** Rotulagem frontal (lupa): limites para alimentos sólidos, por 100 g. */
export function alertasFrontais(t: Tabela): string[] {
  const a: string[] = [];
  if (t.acucares_adic_g >= 15) a.push("AÇÚCAR ADICIONADO");
  if (t.saturadas_g >= 6) a.push("GORDURA SATURADA");
  if (t.sodio_mg >= 600) a.push("SÓDIO");
  return a;
}
