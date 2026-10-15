import { describe, expect, it } from "vitest";
import { descreverCombinacao, melhorCombinacao, opcoesSimples } from "@/lib/embalagens";

const farinha = [
  { id: "1", nome: "Pacote 1 kg", quantidade_base: 1000 },
  { id: "5", nome: "Pacote 5 kg", quantidade_base: 5000 },
  { id: "10", nome: "Pacote 10 kg", quantidade_base: 10000 },
];

describe("embalagens de compra", () => {
  it("sem preço, escolhe a combinação que sobra menos", () => {
    const c = melhorCombinacao(1260, farinha)!;
    expect(descreverCombinacao(c)).toBe("2× Pacote 1 kg");
    expect(c.sobra).toBe(740);
    const d = melhorCombinacao(6200, farinha)!;
    expect(descreverCombinacao(d)).toBe("1× Pacote 5 kg + 2× Pacote 1 kg");
  });
  it("com preço, escolhe a mais barata", () => {
    const comPreco = [
      { ...farinha[0], precoCentavos: 549 },
      { ...farinha[1], precoCentavos: 2200 },
      { ...farinha[2], precoCentavos: 3990 },
    ];
    // 4,2 kg: 5× 1 kg = 27,45; 1× 5 kg = 22,00 → 5 kg ganha
    expect(descreverCombinacao(melhorCombinacao(4200, comPreco)!)).toBe("1× Pacote 5 kg");
    // 9 kg: 10 kg (39,90) é mais barato que 5+4×1 (43,96)
    expect(descreverCombinacao(melhorCombinacao(9000, comPreco)!)).toBe("1× Pacote 10 kg");
  });
  it("latas arredondam para cima", () => {
    const lata = [{ id: "l", nome: "Lata 350 ml", quantidade_base: 350 }];
    const c = melhorCombinacao(367.6, lata)!;
    expect(c.itens[0].quantidade).toBe(2);
    expect(c.sobra).toBeCloseTo(332.4, 1);
    expect(melhorCombinacao(350, lata)!.itens[0].quantidade).toBe(1);
  });
  it("opções simples por embalagem", () => {
    const o = opcoesSimples(1260, farinha);
    expect(o.map((x) => x.itens[0].quantidade)).toEqual([2, 1, 1]);
  });
  it("sem necessidade, nada a sugerir", () => expect(melhorCombinacao(0, farinha)).toBeNull());
});
