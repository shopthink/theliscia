/**
 * Linha simples de custo ao longo do tempo (uma série, sem legenda: o título nomeia).
 * SVG puro, renderizado no servidor; cada ponto tem dica com data e valor.
 */
export interface PontoCusto { data: string; valor: number; detalhe?: string }

const fmtR = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtD = (iso: string) => { const [a, m, d] = iso.slice(0, 10).split("-"); return `${d}/${m}/${a.slice(2)}`; };

export function GraficoCusto({ pontos, unidade, altura = 150, largura = 1000, rotulo }: { pontos: PontoCusto[]; unidade: string; altura?: number; largura?: number; rotulo: string }) {
  if (pontos.length === 0) return <div className="suave" style={{ fontSize: "0.85rem" }}>Sem dados ainda.</div>;
  const L = largura, A = altura, mx = 44, my = 14, mb = 22;
  const vals = pontos.map((p) => p.valor);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (max - min < max * 0.1) { const meio = (max + min) / 2; min = meio * 0.9; max = meio * 1.1 || 1; }
  min = Math.max(0, min);
  const t0 = new Date(pontos[0].data).getTime();
  const t1 = new Date(pontos[pontos.length - 1].data).getTime();
  const x = (iso: string) => pontos.length === 1 || t1 === t0 ? (mx + L - 10) / 2 + mx / 2 : mx + ((new Date(iso).getTime() - t0) / (t1 - t0)) * (L - mx - 10);
  const y = (v: number) => my + (1 - (v - min) / (max - min || 1)) * (A - my - mb);
  const caminho = pontos.map((p, i) => `${i ? "L" : "M"}${x(p.data).toFixed(1)},${y(p.valor).toFixed(1)}`).join(" ");
  const ticks = [min, (min + max) / 2, max];
  return (
    <svg viewBox={`0 0 ${L} ${A}`} className="grafico-custo" role="img" aria-label={`${rotulo}: de ${fmtR(vals[0])} a ${fmtR(vals[vals.length - 1])} por ${unidade}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={mx} x2={L - 4} y1={y(t)} y2={y(t)} className="grade-linha" />
          <text x={mx - 6} y={y(t) + 4} textAnchor="end" className="eixo">{t.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</text>
        </g>
      ))}
      <text x={mx} y={A - 4} className="eixo">{fmtD(pontos[0].data)}</text>
      {pontos.length > 1 && <text x={L - 4} y={A - 4} textAnchor="end" className="eixo">{fmtD(pontos[pontos.length - 1].data)}</text>}
      {pontos.length > 1 && <path d={caminho} className="linha" />}
      {pontos.map((p, i) => (
        <g key={i} className="ponto">
          <circle cx={x(p.data)} cy={y(p.valor)} r={12} className="alvo" />
          <circle cx={x(p.data)} cy={y(p.valor)} r={4} className="marca" />
          <title>{`${fmtD(p.data)}: ${fmtR(p.valor)}/${unidade}${p.detalhe ? ` · ${p.detalhe}` : ""}`}</title>
        </g>
      ))}
    </svg>
  );
}

/** Variação entre o primeiro e o último ponto, em %. */
export function variacao(pontos: PontoCusto[]): number | null {
  if (pontos.length < 2 || !pontos[0].valor) return null;
  return ((pontos[pontos.length - 1].valor - pontos[0].valor) / pontos[0].valor) * 100;
}
