import { describe, expect, it } from "vitest";
import { compararUnidade, gerarSlug, localEntrega, SLUG_VALIDO, unidade } from "@/lib/condominios";
import { resumirCarrinho } from "@/lib/carrinho";

describe("condomínios", () => {
  it("gera link limpo a partir do nome", () => {
    expect(gerarSlug("Residencial Jardins")).toBe("residencial-jardins");
    expect(gerarSlug("  Cond. São João — Torre 2!! ")).toBe("cond-sao-joao-torre-2");
    expect(SLUG_VALIDO.test(gerarSlug("Ápice Vila Madalena"))).toBe(true);
    expect(gerarSlug("x".repeat(60)).length).toBe(40);
  });
  it("formata unidade e local", () => {
    expect(unidade("B", "12")).toBe("Bl B · Ap 12");
    expect(unidade(null, "301")).toBe("Ap 301");
    expect(localEntrega({ modalidade: "entrega", condominio_nome: "Jardins", bloco: null, apto: "3" })).toBe("Jardins · Ap 3");
    expect(localEntrega({ modalidade: "entrega", endereco: "Rua A, 1" })).toBe("Rua A, 1");
    expect(localEntrega({ modalidade: "retirada" })).toBe("Retirada");
  });
  it("ordena bloco e apto naturalmente", () => {
    const l = [{ bloco: "B", apto: "2" }, { bloco: "A", apto: "10" }, { bloco: "A", apto: "2" }].sort(compararUnidade);
    expect(l.map((x) => `${x.bloco}${x.apto}`)).toEqual(["A2", "A10", "B2"]);
  });
  it("carrinho soma taxa só quando há bases", () => {
    const p = [{ id: "a", preco_centavos: 2500 }];
    expect(resumirCarrinho(p, { a: 3 }, 3, 50, 800)).toMatchObject({ itens: 7500, taxa: 800, total: 8300, sinal: 4150, saldo: 4150 });
    expect(resumirCarrinho(p, {}, 3, 100, 800)).toMatchObject({ taxa: 0, total: 0 });
  });
});
