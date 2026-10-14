/** Só dígitos, sem o 55 do Brasil. Igual a public.normalizar_telefone(). */
export function normalizarTelefone(t: string | null | undefined): string {
  const d = String(t ?? "").replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d.slice(2);
  return d;
}

export function telefoneValido(t: string | null | undefined): boolean {
  const d = normalizarTelefone(t);
  return d.length === 10 || d.length === 11;
}

export function formatarTelefone(t: string | null | undefined): string {
  const d = normalizarTelefone(t);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t ?? "";
}

export function linkWhatsApp(t: string, mensagem?: string): string {
  const base = `https://wa.me/55${normalizarTelefone(t)}`;
  return mensagem ? `${base}?text=${encodeURIComponent(mensagem)}` : base;
}
