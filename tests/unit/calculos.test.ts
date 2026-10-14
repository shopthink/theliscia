import { describe, expect, it } from "vitest";
import { formatarBRL, lerBRL, percentualDe } from "@/lib/dinheiro";
import { campanhaAberta, formatarData, hojeSP, validarDatasCampanha } from "@/lib/datas";
import { normalizarTelefone, telefoneValido, formatarTelefone } from "@/lib/telefone";
import { resumirCarrinho } from "@/lib/carrinho";
import { detectarTipo, validarComprovante } from "@/lib/arquivo";
import { basesPorKgFarinha, dimensionarPorBases, dimensionarPorFarinha, massaBase } from "@/lib/receita";
import { custoTempo, normalizarQuantidade, ratear } from "@/lib/rateio";

describe("dinheiro", () => {
  it("formata e lê BRL em centavos", () => {
    expect(formatarBRL(6000)).toBe("R$ 60,00");
    expect(formatarBRL(123456)).toBe("R$ 1.234,56");
    expect(lerBRL("20")).toBe(2000);
    expect(lerBRL("20,5")).toBe(2050);
    expect(lerBRL("R$ 1.234,56")).toBe(123456);
    expect(lerBRL("20.50")).toBe(2050);
    expect(lerBRL("1.000")).toBe(100000);
    expect(lerBRL("abc")).toBeNull();
    expect(lerBRL("-3")).toBeNull();
  });
  it("sinal de 50% arredonda meio centavo para cima, como o banco", () => {
    expect(percentualDe(6000, 50)).toBe(3000);
    expect(percentualDe(4999, 50)).toBe(2500);
  });
});

describe("datas e janela da campanha", () => {
  const c = { ativa: true, abre_em: "2026-10-01", fecha_em: "2026-10-20" };
  it("aceita 20/10 às 23h59 de SP e bloqueia 21/10 (teste 2)", () => {
    expect(hojeSP(new Date("2026-10-21T02:59:00Z"))).toBe("2026-10-20");
    expect(campanhaAberta(c, new Date("2026-10-21T02:59:00Z"))).toBe(true);
    expect(campanhaAberta(c, new Date("2026-10-21T03:00:00Z"))).toBe(false);
    expect(campanhaAberta({ ...c, ativa: false }, new Date("2026-10-10T12:00:00Z"))).toBe(false);
  });
  it("valida a ordem das datas", () => {
    expect(validarDatasCampanha("2026-10-01", "2026-10-20", "2026-10-30")).toBeNull();
    expect(validarDatasCampanha("2026-10-21", "2026-10-20", "2026-10-30")).toMatch(/abertura/);
    expect(validarDatasCampanha("2026-10-01", "2026-10-20", "2026-10-19")).toMatch(/entrega/);
  });
  it("formata datas brasileiras", () => expect(formatarData("2026-10-30")).toBe("30/10/2026"));
});

describe("telefone", () => {
  it("normaliza com e sem 55", () => {
    expect(normalizarTelefone("+55 (11) 98888-7777")).toBe("11988887777");
    expect(normalizarTelefone("(11) 3333-4444")).toBe("1133334444");
    expect(telefoneValido("98888-7777")).toBe(false);
    expect(formatarTelefone("11988887777")).toBe("(11) 98888-7777");
  });
});

describe("carrinho (prévia)", () => {
  const produtos = [{ id: "it", preco_centavos: 2000 }, { id: "ny", preco_centavos: 2000 }];
  it("mínimo é sobre a soma dos tipos (teste 1)", () => {
    expect(resumirCarrinho(produtos, { it: 2, ny: 1 }, 3, 100).atingiuMinimo).toBe(true);
    const r = resumirCarrinho(produtos, { it: 2 }, 3, 100);
    expect(r.atingiuMinimo).toBe(false);
    expect(r.faltam).toBe(1);
  });
  it("três bases de R$ 20 com sinal de 50% (teste 3)", () => {
    expect(resumirCarrinho(produtos, { it: 3 }, 3, 50)).toMatchObject({ total: 6000, sinal: 3000, saldo: 3000 });
  });
});

describe("comprovante", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  it("detecta o tipo real pelo conteúdo", () => {
    expect(detectarTipo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectarTipo(png)).toBe("image/png");
    expect(detectarTipo(new TextEncoder().encode("RIFF1234WEBPVP8 "))).toBe("image/webp");
    expect(detectarTipo(new TextEncoder().encode("%PDF-1.7"))).toBe("application/pdf");
    expect(detectarTipo(new TextEncoder().encode("<svg xmlns="))).toBeNull();
    expect(detectarTipo(new TextEncoder().encode("<html>"))).toBeNull();
  });
  it("recusa arquivo acima de 8 MB", () => {
    const grande = new Uint8Array(8 * 1024 * 1024 + 1);
    grande.set(png);
    expect(validarComprovante(grande)).toMatchObject({ ok: false });
  });
});

describe("receitas", () => {
  const italiana = [
    { insumo_id: "farinha", quantidade: 500, densidade_g: 1 },
    { insumo_id: "cerveja", quantidade: 175, densidade_g: 1 },
    { insumo_id: "agua", quantidade: 165, densidade_g: 1 },
    { insumo_id: "sal", quantidade: 15, densidade_g: 1 },
    { insumo_id: "fermento", quantidade: 2, densidade_g: 1 },
  ];
  const ny = [
    { insumo_id: "farinha", quantidade: 500, densidade_g: 1 },
    { insumo_id: "cerveja", quantidade: 175, densidade_g: 1 },
    { insumo_id: "agua", quantidade: 125, densidade_g: 1 },
    { insumo_id: "azeite", quantidade: 25, densidade_g: 0.91 },
    { insumo_id: "sal", quantidade: 15, densidade_g: 1 },
    { insumo_id: "fermento", quantidade: 2, densidade_g: 1 },
  ];
  it("massa das receitas-base", () => {
    expect(massaBase(italiana)).toBe(857);
    expect(massaBase(ny)).toBe(839.75);
  });
  it("rendimento teórico por kg de farinha com bolinha de 180 g", () => {
    expect(basesPorKgFarinha(italiana, 180, "farinha")).toBe(9.52);
    expect(basesPorKgFarinha(ny, 180, "farinha")).toBe(9.33);
  });
  it("dimensiona por bases e por farinha", () => {
    const r = dimensionarPorBases(italiana, 10, 180);
    expect(r.massaNecessaria).toBe(1800);
    expect(r.ingredientes.find((i) => i.insumo_id === "farinha")!.quantidade).toBeCloseTo(1050.2, 1);
    const f = dimensionarPorFarinha(italiana, 1000, 9, "farinha");
    expect(f.massaTotal).toBe(1714);
    expect(f.pesoBolinha).toBeCloseTo(190.4, 1);
  });
});

describe("compras (base da fase 2)", () => {
  it("converte pacotes em quantidade física (teste 4)", () => {
    expect(normalizarQuantidade(2, 1, "kg")).toEqual({ quantidade: 2000, unidade: "g" });
    expect(normalizarQuantidade(4, 350, "ml")).toEqual({ quantidade: 1400, unidade: "ml" });
    expect(normalizarQuantidade(1, 100, "un")).toEqual({ quantidade: 100, unidade: "un" });
  });
  it("rateia extras sem diferença de centavos (teste 5)", () => {
    expect(ratear([4000, 2000], 1000 + 200 - 300)).toEqual([4600, 2300]);
    const r = ratear([1000, 1000, 1000], 100);
    expect(r.reduce((a, b) => a + b)).toBe(3100);
    expect(ratear([10, 5000], -5005).every((v) => v >= 0)).toBe(true);
    expect(ratear([10, 5000], -5005).reduce((a, b) => a + b)).toBe(5);
  });
  it("tempo de compra conta uma vez (teste 6)", () => expect(custoTempo(30, 2500)).toBe(1250));
});

import { gerarPixCopiaECola } from "@/lib/pix";
describe("pix copia e cola", () => {
  it("reproduz o exemplo do manual do BR Code", () => {
    expect(
      gerarPixCopiaECola({ chave: "123e4567-e12b-12d1-a456-426655440000", nome: "Fulano de Tal", cidade: "BRASILIA" }),
    ).toBe("00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D");
  });
  it("inclui valor e identificador", () => {
    const p = gerarPixCopiaECola({ chave: "a@b.com", nome: "José Ção", cidade: "São Paulo", valorCentavos: 3000, txid: "LISCIA-0001" });
    expect(p).toContain("540530.00");
    expect(p).toContain("5908Jose Cao");
    expect(p).toContain("6009Sao Paulo");
    expect(p).toContain("0510LISCIA0001");
  });
});
