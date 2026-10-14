import { describe, expect, it } from "vitest";
import { embalagemDaDescricao, lerCupom } from "@/lib/cupom";
import { montarLista } from "@/lib/listaCompras";

const CUPOM = `ATACADAO S.A.
CNPJ 75.315.333/0001-09
AV MARGINAL, 1000 - SAO PAULO SP
DOCUMENTO AUXILIAR DA NOTA FISCAL DE CONSUMIDOR ELETRONICA
14/10/2026 10:32:11
001 7891000100103 FARINHA TRIGO TIPO 1 1KG 2 UN X 5,49 10,98
002 7894321711263 CERVEJA PILSEN LATA 350ML 4 UN X 3,29 13,16
003 2000000000001 QUEIJO MUSSARELA KG
0,452 KG X 39,90 18,03
004 7896005800010 SACO VACUO C/100 1 UN X 45,00 45,00
005 7891234567890 PRODUTO SEM EMBALAGEM 1 UN X 7,50 7,50
QTD. TOTAL DE ITENS 5
VALOR TOTAL R$ 94,67
DESCONTO R$ 0,00
VALOR A PAGAR R$ 94,67
FORMA DE PAGAMENTO
CARTAO DE DEBITO 94,67`;

describe("leitura do cupom", () => {
  const r = lerCupom(CUPOM);
  it("encontra fornecedor, data e total", () => {
    expect(r.fornecedor).toBe("ATACADAO S.A.");
    expect(r.data).toBe("2026-10-14");
    expect(r.totalCentavos).toBe(9467);
  });
  it("reconhece itens, quantidades e embalagens", () => {
    expect(r.itens).toHaveLength(5);
    expect(r.itens[0]).toMatchObject({ pacotes: 2, conteudo: 1, unidade: "kg", valorCentavos: 1098 });
    expect(r.itens[0].descricao).toBe("FARINHA TRIGO TIPO 1 1KG");
    expect(r.itens[1]).toMatchObject({ pacotes: 4, conteudo: 350, unidade: "ml", valorCentavos: 1316 });
    expect(r.itens[2]).toMatchObject({ pacotes: 1, conteudo: 0.452, unidade: "kg", valorCentavos: 1803 });
    expect(r.itens[3]).toMatchObject({ pacotes: 1, conteudo: 100, unidade: "un", valorCentavos: 4500 });
  });
  it("não inventa embalagem desconhecida", () => {
    expect(r.itens[4].conteudo).toBeUndefined();
    expect(r.itens[4].unidade).toBeUndefined();
    expect(r.itens.reduce((s, i) => s + (i.valorCentavos ?? 0), 0)).toBe(9467);
  });
  it("lê embalagens comuns", () => {
    expect(embalagemDaDescricao("AZEITE EXTRA VIRGEM 500ML")).toEqual({ conteudo: 500, unidade: "ml" });
    expect(embalagemDaDescricao("SAL REFINADO 1KG")).toEqual({ conteudo: 1, unidade: "kg" });
    expect(embalagemDaDescricao("FERMENTO FRESCO 500G")).toEqual({ conteudo: 500, unidade: "g" });
    expect(embalagemDaDescricao("AGUA 1,5L")).toEqual({ conteudo: 1.5, unidade: "l" });
    expect(embalagemDaDescricao("ETIQUETA 50 UN")).toEqual({ conteudo: 50, unidade: "un" });
    expect(embalagemDaDescricao("PAO FRANCES")).toEqual({});
  });
  it("texto vazio gera rascunho vazio", () => expect(lerCupom("").itens).toEqual([]));
});

describe("lista de compras", () => {
  const insumos = [
    { id: "f", nome: "Farinha", unidade: "g", uso_auxiliar: null, entra_lista_compras: true, ativo: true },
    { id: "a", nome: "Água", unidade: "ml", uso_auxiliar: null, entra_lista_compras: false, ativo: true },
    { id: "s", nome: "Sêmola", unidade: "g", uso_auxiliar: "semola", entra_lista_compras: true, ativo: true },
    { id: "v", nome: "Saco", unidade: "un", uso_auxiliar: "saco_vacuo", entra_lista_compras: true, ativo: true },
    { id: "k", nome: "Sacola", unidade: "un", uso_auxiliar: "sacola", entra_lista_compras: true, ativo: true },
  ];
  const item = { quantidade: 10, peso_bolinha_g: 180, massa_base_g: 857, ingredientes: [{ insumo_id: "f", quantidade: 500 }, { insumo_id: "a", quantidade: 165 }] };
  const aux = { semola_g_por_base: 7, saco_vacuo_por_base: 1, etiqueta_por_base: 1, molho_ml_por_base: 0, sacola_por_pedido: 1 };

  it("calcula necessidade, desconta estoque e ignora água", () => {
    const { linhas, bases } = montarLista([{ itens: [item] }, { itens: [{ ...item, quantidade: 2 }] }], aux, insumos, { f: 1000, v: 50 });
    expect(bases).toBe(12);
    const l = Object.fromEntries(linhas.map((x) => [x.insumo.id, x]));
    expect(l.f.necessidade).toBeCloseTo(1260.2, 1); // 12 × 180 / 857 × 500
    expect(l.f.comprar).toBeCloseTo(260.2, 1);
    expect(l.a.comprar).toBe(0);
    expect(l.s.necessidade).toBe(84);
    expect(l.v.comprar).toBe(0); // 12 necessários, 50 em estoque
    expect(l.k.necessidade).toBe(2); // uma sacola por pedido
  });
});

import { sugerirInsumo } from "@/lib/cupom";
describe("sugestão de insumo", () => {
  const ins = [{ id: "1", nome: "Saco para vácuo" }, { id: "2", nome: "Sacola kraft" }, { id: "3", nome: "Farinha" }, { id: "4", nome: "Sêmola de abertura" }];
  it("prefere a palavra mais específica", () => {
    expect(sugerirInsumo("SACOLA KRAFT M", ins)?.id).toBe("2");
    expect(sugerirInsumo("SACO VACUO C/100", ins)?.id).toBe("1");
    expect(sugerirInsumo("FARINHA TRIGO 1KG", ins)?.id).toBe("3");
    expect(sugerirInsumo("SEMOLA GRANO DURO", ins)?.id).toBe("4");
    expect(sugerirInsumo("CHOCOLATE", ins)).toBeUndefined();
  });
});
