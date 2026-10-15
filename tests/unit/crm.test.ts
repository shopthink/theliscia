import { describe, expect, it } from "vitest";
import { gerarCSV, lerEtiquetas, mensagemSegmento } from "@/lib/crm";

describe("CRM", () => {
  it("mensagens por segmento, sem travessão, com link quando há rodada", () => {
    const c = { entrega_em: "2026-10-30", fecha_em: "2026-10-25" };
    for (const s of ["lead", "novo", "recorrente", "sumido"]) {
      const m = mensagemSegmento(s, "Carla Souza", "The Liscia Pizzas", c, "https://x/pedido?c=j");
      expect(m).toMatch(/^Oi, Carla! Aqui é da The Liscia Pizzas\./);
      expect(m).toContain("https://x/pedido?c=j");
      expect(m).toContain("30/10/2026");
      expect(m).not.toMatch(/[—–]| - /);
      const sem = mensagemSegmento(s, "Carla", "The Liscia", null, "x");
      expect(sem).not.toContain("x ");
      expect(sem).not.toMatch(/[—–]/);
    }
  });
  it("etiquetas sem repetição", () => {
    expect(lerEtiquetas(" Embaixador, prefere NY ,embaixador,, ")).toEqual(["embaixador", "prefere ny"]);
  });
  it("CSV com ; e proteção contra fórmula", () => {
    const csv = gerarCSV(["a", "b"], [["=1+1", 'x;"y"'], [null, 3]]);
    expect(csv).toBe('﻿a;b\r\n\'=1+1;"x;""y"""\r\n;3');
  });
});
