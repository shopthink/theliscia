import { describe, expect, it } from "vitest";
import { alertasFrontais, arredondar, calcularPor100g, percentualVD, porcao } from "@/lib/nutricao";

const ins = (id: string, nome: string, v: Partial<Record<string, number>> | null) => ({
  id, nome,
  nutri_kcal: v ? v.kcal ?? 0 : null, nutri_carboidratos_g: v?.carb ?? 0, nutri_acucares_totais_g: v?.acu ?? 0, nutri_acucares_adic_g: 0,
  nutri_proteinas_g: v?.prot ?? 0, nutri_gorduras_g: v?.gord ?? 0, nutri_saturadas_g: v?.sat ?? 0, nutri_trans_g: 0,
  nutri_fibras_g: v?.fib ?? 0, nutri_sodio_mg: v?.sod ?? 0,
});

const insumos = [
  ins("f", "Farinha", { kcal: 360, carb: 75.1, acu: 0.3, prot: 9.8, gord: 1.4, sat: 0.2, fib: 2.3, sod: 1 }),
  ins("c", "Cerveja", { kcal: 41, carb: 3.3, prot: 0.6, sod: 4 }),
  ins("a", "Água", { kcal: 0 }),
  ins("s", "Sal", { kcal: 0, sod: 39300 }),
  ins("y", "Fermento", { kcal: 105, carb: 18.1, prot: 8.4, gord: 1.9, sat: 0.2, fib: 8.1, sod: 30 }),
  ins("x", "Sem dados", null),
];
const italiana = [
  { insumo_id: "f", quantidade: 500 }, { insumo_id: "c", quantidade: 175 }, { insumo_id: "a", quantidade: 165 },
  { insumo_id: "s", quantidade: 15 }, { insumo_id: "y", quantidade: 2 },
];

describe("tabela nutricional", () => {
  it("massa crua: sódio por 100 g da receita sem perda de peso", () => {
    const { tabela } = calcularPor100g(italiana, insumos, 857, 857, 857);
    // sódio total = 5 + 7 + 5895 + 0,6 = 5907,6 mg em 857 g
    expect(Math.round(tabela.sodio_mg)).toBe(689);
    expect(Math.round(tabela.kcal)).toBe(219); // (1800 + 71,75 + 2,1) / 8,57
  });
  it("assada: a perda de água concentra os nutrientes", () => {
    const { tabela } = calcularPor100g(italiana, insumos, 857, 180, 150);
    expect(Math.round(tabela.sodio_mg)).toBe(827);
    expect(alertasFrontais(tabela)).toEqual(["SÓDIO"]);
    const p = porcao(tabela, 150);
    expect(Math.round(p.sodio_mg)).toBe(1241);
    expect(percentualVD("sodio_mg", p.sodio_mg)).toBe(62);
    expect(percentualVD("trans_g", 0)).toBeNull();
  });
  it("avisa insumos sem dados", () => {
    expect(calcularPor100g([...italiana, { insumo_id: "x", quantidade: 10 }], insumos, 867, 180, 150).semDados).toEqual(["Sem dados"]);
  });
  it("arredonda como na tabela", () => {
    expect(arredondar("kcal", 262.6)).toBe(263);
    expect(arredondar("proteinas_g", 9.84)).toBe(9.8);
    expect(arredondar("carboidratos_g", 52.6)).toBe(53);
  });
});
