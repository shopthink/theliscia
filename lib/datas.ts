export const FUSO = "America/Sao_Paulo";

/** Data de hoje (AAAA-MM-DD) no fuso de São Paulo. */
export function hojeSP(agora: Date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(agora);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

/** "2026-10-30" → "30/10/2026" */
export function formatarData(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** "2026-10-30" → "sexta-feira, 30 de outubro" */
export function formatarDataExtenso(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d, 12));
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(dt);
}

export function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

export interface JanelaCampanha {
  ativa: boolean;
  abre_em: string;
  fecha_em: string;
}

/** Mesma regra do banco: ativa e hoje (SP) entre abertura e encerramento, inclusive. */
export function campanhaAberta(c: JanelaCampanha, agora: Date = new Date()): boolean {
  const hoje = hojeSP(agora);
  return c.ativa && hoje >= c.abre_em && hoje <= c.fecha_em;
}

export type ErroDatas = string | null;

export function validarDatasCampanha(abre: string, fecha: string, entrega: string): ErroDatas {
  if (!abre || !fecha || !entrega) return "Preencha abertura, encerramento e entrega.";
  if (abre > fecha) return "A abertura não pode ser depois do encerramento.";
  if (entrega < fecha) return "A entrega não pode ser antes do encerramento dos pedidos.";
  return null;
}
