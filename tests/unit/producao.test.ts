import { describe, expect, it } from "vitest";
import { minutosAtivos } from "@/lib/producao";
import { formatarMinutos, isoParaLocalSP, localSPparaISO } from "@/lib/datas";

describe("produção", () => {
  it("soma sessões e conta a aberta até agora", () => {
    const s = [
      { id: "1", etapa: "massa", inicio: "2026-10-05T11:00:00Z", fim: "2026-10-05T11:30:00Z" },
      { id: "2", etapa: "assar", inicio: "2026-10-07T13:00:00Z", fim: "2026-10-07T14:00:00Z" },
      { id: "3", etapa: "embalar", inicio: "2026-10-08T12:00:00Z", fim: null },
    ];
    expect(minutosAtivos(s, Date.parse("2026-10-08T12:30:00Z"))).toBe(120);
  });
  it("formata e converte horários de São Paulo", () => {
    expect(formatarMinutos(45)).toBe("45 min");
    expect(formatarMinutos(125)).toBe("2 h 05 min");
    expect(localSPparaISO("2026-10-05T08:00")).toBe("2026-10-05T11:00:00.000Z");
    expect(isoParaLocalSP("2026-10-05T11:00:00.000Z")).toBe("2026-10-05T08:00");
  });
});
