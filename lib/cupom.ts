/**
 * Interpretação heurística do texto de um cupom/nota (vindo do OCR).
 * Gera um RASCUNHO: o que não for reconhecido fica vazio para revisão. Nada é inventado.
 */

export interface ItemCupom {
  descricao: string;
  pacotes?: number;
  conteudo?: number;
  unidade?: "g" | "kg" | "ml" | "l" | "un";
  valorCentavos?: number;
}

export interface LeituraCupom {
  fornecedor?: string;
  data?: string; // AAAA-MM-DD
  totalCentavos?: number;
  itens: ItemCupom[];
}

const DINHEIRO = /(\d{1,3}(?:\.\d{3})*,\d{2})(?!\d)/g;
const IGNORAR = /\b(TOTAL|SUBTOTAL|SUB-TOTAL|DESCONTO|DESC\.|TROCO|PAGAR|PAGO|DINHEIRO|CART[AÃ]O|CREDITO|CR[EÉ]DITO|D[EÉ]BITO|DEBITO|PIX|TRIBUTOS|ACR[EÉ]SCIMO|VALOR APROX|LEI 12|CNPJ|CPF|IE:|INSC|FORMA DE|QTD\.? TOTAL|ITENS)\b/;

export function centavos(texto: string): number {
  return Number(texto.replace(/\./g, "").replace(",", ""));
}

function numero(texto: string): number {
  return Number(texto.replace(",", "."));
}

/** "FARINHA TRIGO 1KG" → {conteudo: 1, unidade: "kg"}; "LATA 350ML" → {350, "ml"}; "C/100" → {100, "un"} */
export function embalagemDaDescricao(desc: string): Pick<ItemCupom, "conteudo" | "unidade"> {
  const d = desc.toUpperCase();
  const m = d.match(/(\d+(?:[.,]\d+)?)\s*(KG|KGS|G|GR|GRS|ML|LT|LTS|L)\b/);
  if (m) {
    const valor = numero(m[1]);
    const u = m[2];
    if (valor > 0) {
      if (u.startsWith("KG")) return { conteudo: valor, unidade: "kg" };
      if (u === "G" || u.startsWith("GR")) return { conteudo: valor, unidade: "g" };
      if (u === "ML") return { conteudo: valor, unidade: "ml" };
      return { conteudo: valor, unidade: "l" };
    }
  }
  const un = d.match(/\bC\/\s*(\d+)\b|\b(\d+)\s*(?:UN|UNID|UNIDADES|PCS)\b/);
  if (un) {
    const v = Number(un[1] ?? un[2]);
    if (v > 0) return { conteudo: v, unidade: "un" };
  }
  return {};
}

export function lerCupom(texto: string): LeituraCupom {
  const linhas = texto
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const r: LeituraCupom = { itens: [] };

  // Fornecedor: primeira linha com nome (antes de CNPJ/endereço)
  for (const l of linhas.slice(0, 6)) {
    if (/[A-ZÀ-Ú]{3,}/i.test(l) && !/CNPJ|CPF|RUA|AV\.|AVENIDA|DOCUMENTO|CUPOM|NFC|\d{5}-?\d{3}/i.test(l)) {
      r.fornecedor = l.slice(0, 120);
      break;
    }
  }

  // Data
  const d = texto.match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
  if (d) {
    const ano = d[3].length === 2 ? `20${d[3]}` : d[3];
    const mes = Number(d[2]);
    const dia = Number(d[1]);
    if (mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) r.data = `${ano}-${d[2]}-${d[1]}`;
  }

  // Total: prefere "VALOR A PAGAR", senão o último "TOTAL"
  let total: number | undefined;
  for (const l of linhas) {
    const u = l.toUpperCase();
    const vals = [...l.matchAll(DINHEIRO)].map((m) => m[1]);
    if (!vals.length) continue;
    if (/VALOR A PAGAR|TOTAL A PAGAR/.test(u)) total = centavos(vals[vals.length - 1]);
    else if (/\bTOTAL\b/.test(u) && !/SUBTOTAL|QTD|ITENS|TRIBUTOS|APROX/.test(u) && total === undefined) {
      total = centavos(vals[vals.length - 1]);
    }
  }
  r.totalCentavos = total;

  // Itens
  let pendente: string | null = null;
  for (const l of linhas) {
    const u = l.toUpperCase();
    const vals = [...l.matchAll(DINHEIRO)];
    // Letras de descrição (ignora unidades e o "X" da multiplicação)
    const letras = (u.replace(/\b(UN|UND|UNID|KG|PC|PCT|CX|LT|L|G|X)\b/g, "").match(/[A-ZÀ-Ú]/g) ?? []).length;
    if (IGNORAR.test(u)) {
      pendente = null;
      continue;
    }
    if (!vals.length) {
      // Possível descrição com valores na linha seguinte
      pendente = letras >= 3 ? l : null;
      continue;
    }
    let linha = l;
    if (letras < 3) {
      if (!pendente) continue;
      linha = `${pendente} ${l}`;
    }
    pendente = null;
    const item = interpretarLinha(linha);
    if (item) r.itens.push(item);
  }
  return r;
}

function interpretarLinha(linha: string): ItemCupom | null {
  const u = linha.toUpperCase();
  const vals = [...u.matchAll(DINHEIRO)];
  const ultimo = vals[vals.length - 1];
  const valorCentavos = centavos(ultimo[1]);
  if (!valorCentavos) return null;

  let pacotes: number | undefined;
  let pesado: number | undefined;
  const q = u.match(/(\d+(?:,\d{1,3})?)\s*(UN|UND|UNID|PC|PCT|CX|KG|LT|L|G)?\s*[X×]\s*(\d{1,3}(?:\.\d{3})*,\d{2,3})/);
  let antesDaQtd = u.slice(0, ultimo.index);
  if (q) {
    const qtd = numero(q[1]);
    if (q[2] === "KG") pesado = qtd;
    else if (Number.isInteger(qtd) && qtd > 0) pacotes = qtd;
    antesDaQtd = u.slice(0, q.index);
  }

  // Descrição: tira número do item, código de barras e restos numéricos do fim
  let descricao = antesDaQtd
    .replace(/^\s*\d{1,3}\s+/, "")
    .replace(/\b\d{6,14}\b/g, "")
    .replace(/\s+\d+(?:,\d+)?\s*$/, "")
    .replace(/\s+KG\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (descricao.length < 2) return null;

  const item: ItemCupom = { descricao, valorCentavos };
  if (pesado) {
    item.pacotes = 1;
    item.conteudo = pesado;
    item.unidade = "kg";
  } else {
    if (pacotes) item.pacotes = pacotes;
    Object.assign(item, embalagemDaDescricao(descricao));
  }
  return item;
}

function normalizar(t: string) {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

/** Sugere o insumo pela palavra principal do nome (a mais longa que aparecer na descrição). */
export function sugerirInsumo<T extends { id: string; nome: string }>(descricao: string, insumos: T[]): T | undefined {
  const d = ` ${normalizar(descricao).replace(/[^A-Z0-9 ]/g, " ")} `;
  let melhor: T | undefined;
  let tamanho = 0;
  for (const i of insumos) {
    const chave = normalizar(i.nome).split(/\s+/)[0].replace(/[^A-Z0-9]/g, "");
    if (chave.length < 3) continue;
    if (d.includes(` ${chave}`) && chave.length > tamanho) {
      melhor = i;
      tamanho = chave.length;
    }
  }
  return melhor;
}
