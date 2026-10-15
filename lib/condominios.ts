/** Entrega por condomínio: textos e formatação compartilhados entre painel, link público e etiqueta. */

export const FORMA_ENTREGA: Record<string, string> = {
  portaria: "Na portaria, em horário marcado",
  porta: "Na porta do apartamento",
};

/** "Jardins Residencial" → "jardins-residencial" (sem acento, só letras, números e hífen). */
export function gerarSlug(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export const SLUG_VALIDO = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** "Bl B · Ap 12" (bloco opcional). */
export function unidade(bloco?: string | null, apto?: string | null): string {
  return [bloco ? `Bl ${bloco}` : null, apto ? `Ap ${apto}` : null].filter(Boolean).join(" · ");
}

/** Local de entrega numa linha: condomínio + unidade, endereço avulso ou retirada. */
export function localEntrega(p: {
  modalidade: string;
  endereco?: string | null;
  condominio_nome?: string | null;
  bloco?: string | null;
  apto?: string | null;
}): string {
  if (p.modalidade === "retirada") return "Retirada";
  if (p.condominio_nome) return [p.condominio_nome, unidade(p.bloco, p.apto)].filter(Boolean).join(" · ");
  return p.endereco ?? "Entrega";
}

/** Ordena bloco/apto de forma natural (A2 antes de A10). */
export function compararUnidade(a: { bloco?: string | null; apto?: string | null }, b: { bloco?: string | null; apto?: string | null }) {
  const c = (x?: string | null) => x ?? "";
  return c(a.bloco).localeCompare(c(b.bloco), "pt-BR", { numeric: true }) || c(a.apto).localeCompare(c(b.apto), "pt-BR", { numeric: true });
}
