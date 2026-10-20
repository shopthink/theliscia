import { describe, expect, it } from "vitest";
import { calcularFechamento, intervaloMes, mesAnterior } from "@/lib/fechamento";

const lote = { status: "concluido", unidades_boas: 10, custo_materiais_centavos: 3000, custo_mao_obra_centavos: 2000 };

describe("fechamento", () => {
  it("separa vendas, CMV, mão de obra, brindes, perdas e inventário", () => {
    const f = calcularFechamento(
      [
        { tipo: "venda", total_centavos: 6800, taxa_entrega_centavos: 800, recebido_centavos: 6800, itens: [{ receita: "Italiana", quantidade: 3, subtotal: 6000, lote }] },
        { tipo: "venda", total_centavos: 4000, taxa_entrega_centavos: 0, recebido_centavos: 2000, itens: [{ receita: "Italiana", quantidade: 2, subtotal: 4000, lote: null }] },
        { tipo: "brinde", total_centavos: 0, taxa_entrega_centavos: 0, recebido_centavos: 0, itens: [{ receita: "Italiana", quantidade: 2, subtotal: 0, lote }] },
      ],
      [
        { tipo: "perda", categoria: "derramou", valor_centavos: -500 },
        { tipo: "perda", categoria: "derramou", valor_centavos: -100 },
        { tipo: "ajuste", categoria: "inventario", valor_centavos: -250 },
      ],
      [{ unidades_boas: 10, perdas: 2, custo_materiais_centavos: 3000 }],
      300,
    );
    expect(f).toMatchObject({
      pedidos: 2, bases: 5, receitaProdutos: 10000, taxasEntrega: 800, receita: 10800, recebido: 8800, aReceber: 2000,
      cmv: 900, maoDeObra: 600, basesSemCusto: 2, perdasEstoque: 600, inventario: -250, basesPerdidas: 2, valorBasesPerdidas: 500,
    });
    expect(f.brindes).toEqual({ pedidos: 1, bases: 2, materiais: 600, maoDeObra: 400, semCusto: 0 });
    expect(f.perdasPorMotivo).toEqual({ derramou: 600 });
    expect(f.margemBruta).toBe(9900);
    expect(f.resultado).toBe(10800 - 900 - 600 - 1000 - 600 - 250 - 300);
    expect(f.porReceita).toEqual([{ receita: "Italiana", bases: 5, receita_centavos: 10000, custo: 1500, semCusto: 2 }]);
  });
  it("meses", () => {
    expect(intervaloMes("2026-02")).toEqual({ inicio: "2026-02-01", fim: "2026-02-28" });
    expect(mesAnterior("2026-01")).toBe("2025-12");
  });
});
