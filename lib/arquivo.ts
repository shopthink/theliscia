export const TAMANHO_MAXIMO = 8 * 1024 * 1024;
export const TIPOS_ACEITOS = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type TipoAceito = (typeof TIPOS_ACEITOS)[number];

export const EXTENSAO: Record<TipoAceito, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/** Identifica o tipo real pelo conteúdo (assinatura), não pelo nome nem pelo que o navegador diz. */
export function detectarTipo(bytes: Uint8Array): TipoAceito | null {
  const b = (i: number) => bytes[i];
  if (bytes.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b(i) === v)) return "image/png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 5 && ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

function ascii(bytes: Uint8Array, ini: number, fim: number) {
  return String.fromCharCode(...bytes.slice(ini, fim));
}

export function validarComprovante(bytes: Uint8Array): { ok: true; tipo: TipoAceito } | { ok: false; erro: string } {
  if (bytes.length === 0) return { ok: false, erro: "Arquivo vazio." };
  if (bytes.length > TAMANHO_MAXIMO) return { ok: false, erro: "O arquivo passa de 8 MB." };
  const tipo = detectarTipo(bytes);
  if (!tipo) return { ok: false, erro: "Envie uma imagem JPG, PNG, WebP ou um PDF." };
  return { ok: true, tipo };
}
