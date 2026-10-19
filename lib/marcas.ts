/** Marcas dos insumos: combinação para o rótulo, nutrição com reserva, sugestões. */
import { NUTRIENTES, type InsumoNutri } from "./nutricao";

export interface MarcaBasica {
  id: string;
  insumo_id: string;
  nome: string;
  nome_rotulo?: string | null;
  em_uso?: boolean;
  ativo?: boolean;
}

/** Combinação {insumo_id: marca_id|null} → chave canônica. Igual a public.chave_marcas(). */
export function chaveMarcas(marcas: Record<string, string | null | undefined>): string {
  return Object.keys(marcas)
    .sort()
    .map((k) => `${k}:${marcas[k] || "-"}`)
    .join("|");
}

/** Dados nutricionais usados no cálculo: os da marca, se preenchidos; senão os genéricos do insumo. */
export function nutricaoComMarca(insumo: InsumoNutri, marca: Partial<InsumoNutri> | null | undefined): InsumoNutri {
  if (!marca || marca.nutri_kcal == null) return insumo;
  const r: any = { ...insumo, nome: insumo.nome };
  for (const n of NUTRIENTES) r[`nutri_${n.chave}`] = (marca as any)[`nutri_${n.chave}`] ?? 0;
  return r;
}

/** Lista de ingredientes em ordem decrescente de quantidade, com o nome de rótulo da marca. */
export function sugerirIngredientes(
  ingredientes: { insumo_id: string; nome: string; quantidade: number; densidade_g?: number }[],
  marcaDe: (insumoId: string) => { nome_rotulo?: string | null } | null | undefined,
): string {
  const itens = [...ingredientes]
    .sort((a, b) => b.quantidade * (b.densidade_g ?? 1) - a.quantidade * (a.densidade_g ?? 1))
    .map((i) => (marcaDe(i.insumo_id)?.nome_rotulo?.trim() || i.nome.toLowerCase()));
  if (!itens.length) return "";
  const texto = itens.length > 1 ? `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}` : itens[0];
  return texto.charAt(0).toUpperCase() + texto.slice(1) + ".";
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Reconhece a marca pela descrição do cupom ("FAR TRIGO CAPUTO PIZZ 1KG" → Caputo Pizzeria). */
export function sugerirMarca<T extends { nome: string }>(descricao: string, marcas: T[]): T | null {
  const d = semAcento(descricao).replace(/[^a-z0-9]+/g, " ");
  const palavras = new Set(d.split(" ").filter((p) => p.length >= 3));
  let melhor: T | null = null;
  let nota = 0;
  for (const m of marcas) {
    const tokens = semAcento(m.nome).split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
    if (!tokens.length) continue;
    let pontos = 0;
    for (const t of tokens) {
      if (palavras.has(t)) pontos += 2;
      else if ([...palavras].some((p) => p.length >= 4 && (t.startsWith(p) || p.startsWith(t)))) pontos += 1;
    }
    // A primeira palavra da marca costuma ser a que importa (Caputo, Embramex)
    if (pontos > 0 && (palavras.has(tokens[0]) || [...palavras].some((p) => p.length >= 4 && tokens[0].startsWith(p)))) pontos += 1;
    if (pontos > nota) { nota = pontos; melhor = m; }
  }
  return nota >= 2 ? melhor : null;
}

/** Centavos por unidade base → texto "R$ x por kg/L/un". */
export function precoPorEmbalagemBase(centavosPorUnidade: number | null | undefined, unidade: string): string {
  if (centavosPorUnidade == null || !Number.isFinite(Number(centavosPorUnidade))) return "—";
  const v = unidade === "un" ? Number(centavosPorUnidade) : Number(centavosPorUnidade) * 1000;
  return `${(v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/${unidade === "g" ? "kg" : unidade === "ml" ? "L" : "un"}`;
}
