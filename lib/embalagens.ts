/**
 * Converte a necessidade em gramas/ml/unidades em pacotes inteiros que dá para comprar.
 * Com preços conhecidos, escolhe a combinação mais barata; sem preço, a que sobra menos.
 */

export interface Embalagem {
  id: string;
  nome: string;
  quantidade_base: number; // em g, ml ou un
  precoCentavos?: number | null; // preço de UM pacote (última compra ou estimativa)
}

export interface Combinacao {
  itens: { embalagem: Embalagem; quantidade: number }[];
  total: number;
  sobra: number;
  custoCentavos: number | null;
}

function custo(itens: Combinacao["itens"]) {
  let c = 0;
  for (const i of itens) {
    if (i.embalagem.precoCentavos == null) return null;
    c += i.embalagem.precoCentavos * i.quantidade;
  }
  return c;
}

/** Comprar cada embalagem sozinha: quantos pacotes e quanto sobra. */
export function opcoesSimples(necessidade: number, embalagens: Embalagem[]): Combinacao[] {
  return embalagens
    .filter((e) => e.quantidade_base > 0)
    .map((e) => {
      const n = Math.max(1, Math.ceil(necessidade / e.quantidade_base - 1e-9));
      const itens = [{ embalagem: e, quantidade: n }];
      return { itens, total: n * e.quantidade_base, sobra: n * e.quantidade_base - necessidade, custoCentavos: custo(itens) };
    })
    .sort((a, b) => a.sobra - b.sobra);
}

export function melhorCombinacao(necessidade: number, embalagens: Embalagem[]): Combinacao | null {
  const ems = embalagens.filter((e) => e.quantidade_base > 0).sort((a, b) => b.quantidade_base - a.quantidade_base);
  if (!ems.length || !(necessidade > 0)) return null;
  const todosComPreco = ems.every((e) => e.precoCentavos != null);
  let melhor: Combinacao | null = null;
  let avaliadas = 0;

  const melhorQue = (a: Combinacao, b: Combinacao | null) => {
    if (!b) return true;
    if (todosComPreco && a.custoCentavos !== b.custoCentavos) return (a.custoCentavos ?? Infinity) < (b.custoCentavos ?? Infinity);
    if (Math.abs(a.sobra - b.sobra) > 1e-9) return a.sobra < b.sobra;
    const pa = a.itens.reduce((s, i) => s + i.quantidade, 0);
    const pb = b.itens.reduce((s, i) => s + i.quantidade, 0);
    return pa < pb;
  };

  const visitar = (k: number, atual: number[], total: number) => {
    if (++avaliadas > 50000) return;
    if (total >= necessidade - 1e-9) {
      const itens = atual.map((q, i) => ({ embalagem: ems[i], quantidade: q })).filter((x) => x.quantidade > 0);
      const c: Combinacao = { itens, total, sobra: total - necessidade, custoCentavos: custo(itens) };
      if (melhorQue(c, melhor)) melhor = c;
      return;
    }
    if (k >= ems.length) return;
    const e = ems[k];
    const max = Math.min(200, Math.ceil((necessidade - total) / e.quantidade_base - 1e-9));
    for (let q = max; q >= 0; q--) {
      atual[k] = q;
      visitar(k + 1, atual, total + q * e.quantidade_base);
    }
    atual[k] = 0;
  };
  visitar(0, ems.map(() => 0), 0);
  return melhor;
}

export function descreverCombinacao(c: Combinacao) {
  return c.itens.map((i) => `${i.quantidade}× ${i.embalagem.nome}`).join(" + ");
}
