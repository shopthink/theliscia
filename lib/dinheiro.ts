/** Valores monetários sempre em centavos inteiros. */

const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatarBRL(centavos: number | null | undefined): string {
  if (centavos == null || Number.isNaN(centavos)) return "—";
  return fmt.format(centavos / 100).replace(/ /g, " ");
}

/** "20", "20,5", "R$ 1.234,56", "20.50" → centavos. Retorna null se inválido. */
export function lerBRL(texto: string | null | undefined): number | null {
  if (texto == null) return null;
  let t = String(texto).replace(/[R$\s]/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [inteiro, frac = ""] = t.split(".");
  return Number(inteiro) * 100 + Number((frac + "00").slice(0, 2));
}

/** Percentual de um valor, arredondado como no banco (meio centavo para cima). */
export function percentualDe(centavos: number, percentual: number): number {
  return Math.round((centavos * percentual) / 100);
}
