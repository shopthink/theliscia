"use client";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { EstadoForm } from "@/lib/erros";

type Acao = (estado: EstadoForm, dados: FormData) => Promise<EstadoForm>;

/** Formulário ligado a uma Server Action, com mensagem de erro/sucesso e botão com estado de envio. */
export function FormAcao({
  acao,
  children,
  botao = "Salvar",
  classeBotao = "",
  confirmar,
  limparAoSalvar = false,
  className,
}: {
  acao: Acao;
  children?: React.ReactNode;
  botao?: string | null;
  classeBotao?: string;
  confirmar?: string;
  limparAoSalvar?: boolean;
  className?: string;
}) {
  const [estado, enviar] = useActionState(acao, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (estado.ok && limparAoSalvar) ref.current?.reset();
  }, [estado, limparAoSalvar]);
  return (
    <form
      ref={ref}
      action={enviar}
      className={className}
      onSubmit={(e) => {
        if (confirmar && !window.confirm(confirmar)) e.preventDefault();
      }}
    >
      {estado.erro && <div className="aviso erro" role="alert">{estado.erro}</div>}
      {estado.ok && <div className="aviso ok" role="status">{estado.ok}</div>}
      {children}
      {botao && <BotaoEnviar className={classeBotao}>{botao}</BotaoEnviar>}
    </form>
  );
}

export function BotaoEnviar({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? "Salvando…" : children}
    </button>
  );
}
