"use client";
export function BotaoImprimir({ rotulo = "Imprimir" }: { rotulo?: string }) {
  return <button type="button" className="bordo" onClick={() => window.print()}>{rotulo}</button>;
}
