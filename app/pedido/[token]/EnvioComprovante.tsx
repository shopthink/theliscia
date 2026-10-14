"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clienteNavegador } from "@/lib/supabase/navegador";
import { TAMANHO_MAXIMO, TIPOS_ACEITOS } from "@/lib/arquivo";
import { confirmarComprovante, prepararComprovante } from "../actions";

export function EnvioComprovante({ token }: { token: string }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [etapa, setEtapa] = useState<"livre" | "enviando" | "ok">("livre");
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const arquivo = ref.current?.files?.[0];
    if (!arquivo) return setErro("Escolha o arquivo do comprovante.");
    if (arquivo.size > TAMANHO_MAXIMO) return setErro("O arquivo passa de 8 MB.");
    if (!(TIPOS_ACEITOS as readonly string[]).includes(arquivo.type)) return setErro("Envie uma imagem JPG, PNG, WebP ou um PDF.");
    setEtapa("enviando");
    try {
      const prep = await prepararComprovante(token, arquivo.type, arquivo.size);
      if ("erro" in prep) throw new Error(prep.erro);
      const { error } = await clienteNavegador()
        .storage.from("comprovantes")
        .uploadToSignedUrl(prep.caminho, prep.tokenEnvio, arquivo, { contentType: arquivo.type });
      if (error) throw new Error("Falha no envio do arquivo. Verifique a conexão e tente de novo.");
      const r = await confirmarComprovante(token, prep.caminho);
      if (r.erro) throw new Error(r.erro);
      setEtapa("ok");
      router.refresh();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível enviar.");
      setEtapa("livre");
    }
  }

  if (etapa === "ok") return <div className="aviso ok">Comprovante enviado. Agora é com a gente: vamos conferir e confirmar pelo WhatsApp.</div>;

  return (
    <form onSubmit={enviar}>
      {erro && <div className="aviso erro" role="alert">{erro}</div>}
      <div className="campo">
        <label htmlFor="arquivo">Foto, print ou PDF do comprovante</label>
        <input id="arquivo" ref={ref} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required
          style={{ padding: "0.5rem", background: "var(--papel)", border: "1.5px dashed var(--linha)", borderRadius: 10, width: "100%" }} />
        <span className="ajuda">JPG, PNG, WebP ou PDF, até 8 MB.</span>
      </div>
      <button type="submit" className="bordo largo" disabled={etapa === "enviando"}>
        {etapa === "enviando" ? "Enviando…" : "Enviar comprovante"}
      </button>
    </form>
  );
}
