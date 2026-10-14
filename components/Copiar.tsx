"use client";
import { useState } from "react";

export function Copiar({ texto, rotulo = "Copiar", className = "contorno pequeno" }: { texto: string; rotulo?: string; className?: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto);
        } catch {
          const t = document.createElement("textarea");
          t.value = texto;
          document.body.appendChild(t);
          t.select();
          document.execCommand("copy");
          t.remove();
        }
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2500);
      }}
    >
      {copiado ? "Copiado ✓" : rotulo}
    </button>
  );
}
