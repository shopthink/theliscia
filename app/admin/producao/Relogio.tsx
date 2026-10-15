"use client";
import { useEffect, useState } from "react";

function useAgora(intervalo = 1000) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), intervalo);
    return () => clearInterval(t);
  }, [intervalo]);
  return agora;
}

export function duracao(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
}

/** Tempo correndo desde um instante. */
export function Relogio({ desde, base = 0 }: { desde: string; base?: number }) {
  const agora = useAgora();
  return <span suppressHydrationWarning>{duracao(agora - Date.parse(desde) + base)}</span>;
}

/** Tempo correndo de várias sessões (soma das fechadas + aberta). */
export function TotalTrabalho({ minutosFechados, abertaDesde }: { minutosFechados: number; abertaDesde?: string | null }) {
  const agora = useAgora();
  const ms = minutosFechados * 60000 + (abertaDesde ? agora - Date.parse(abertaDesde) : 0);
  return <span suppressHydrationWarning>{duracao(ms)}</span>;
}

/** Contagem regressiva até inicio + alvo; depois mostra quanto passou. */
export function Regressiva({ desde, alvoMin }: { desde: string; alvoMin: number }) {
  const agora = useAgora(15000);
  const fim = Date.parse(desde) + alvoMin * 60000;
  const falta = fim - agora;
  if (falta <= 0) return <span style={{ color: "var(--ok)", fontWeight: 600 }} suppressHydrationWarning>pronto há {formatar(-falta)}</span>;
  return <span suppressHydrationWarning>faltam {formatar(falta)}</span>;
}

function formatar(ms: number) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${String(min % 60).padStart(2, "0")}`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}
