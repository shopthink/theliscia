import { describe, expect, it } from "vitest";
import { chaveMarcas, nutricaoComMarca, precoPorEmbalagemBase, sugerirIngredientes, sugerirMarca } from "@/lib/marcas";

describe("marcas", () => {
  it("chave canônica igual à do banco (ordem binária, - para sem marca)", () => {
    expect(chaveMarcas({ "b-1": "m2", "a-9": null, "a-10": "" })).toBe("a-10:-|a-9:-|b-1:m2");
    expect(chaveMarcas({})).toBe("");
  });
  it("nutrição da marca quando preenchida; senão a genérica", () => {
    const ins: any = { id: "f", nome: "Farinha", nutri_kcal: 360, nutri_sodio_mg: 1 };
    expect(nutricaoComMarca(ins, { nutri_kcal: null } as any)).toBe(ins);
    const m = nutricaoComMarca(ins, { nutri_kcal: 350, nutri_sodio_mg: 2 } as any) as any;
    expect([m.nutri_kcal, m.nutri_sodio_mg, m.nutri_fibras_g, m.nome]).toEqual([350, 2, 0, "Farinha"]);
  });
  it("lista de ingredientes em ordem decrescente com nome de rótulo", () => {
    const t = sugerirIngredientes(
      [{ insumo_id: "s", nome: "Sal", quantidade: 30 }, { insumo_id: "f", nome: "Farinha", quantidade: 1000 }, { insumo_id: "c", nome: "Cerveja", quantidade: 350 }],
      (id) => (id === "f" ? { nome_rotulo: "farinha de trigo tipo 00" } : null),
    );
    expect(t).toBe("Farinha de trigo tipo 00, cerveja e sal.");
  });
  it("reconhece a marca na descrição do cupom", () => {
    const marcas = [{ nome: "Caputo Pizzeria" }, { nome: "Embramex" }, { nome: "Dona Benta" }];
    expect(sugerirMarca("FAR TRIGO CAPUTO PIZZ 1KG", marcas)?.nome).toBe("Caputo Pizzeria");
    expect(sugerirMarca("FARINHA EMBRAMEX T1 5KG", marcas)?.nome).toBe("Embramex");
    expect(sugerirMarca("FARINHA TRIGO 1KG", marcas)).toBeNull();
  });
  it("preço por kg", () => {
    expect(precoPorEmbalagemBase(1.5, "g")).toMatch(/15,00\/kg$/);
    expect(precoPorEmbalagemBase(null, "g")).toBe("—");
  });
});
