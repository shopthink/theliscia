const PAGAMENTO: Record<string, [string, string]> = {
  pendente: ["Pagamento pendente", "alerta"],
  em_conferencia: ["Em conferência", "alerta"],
  sinal_confirmado: ["Sinal confirmado", ""],
  integral_confirmado: ["Pago", "ok"],
  recusado: ["Recusado", "erro"],
};
const PRODUCAO: Record<string, [string, string]> = {
  confirmado: ["Confirmado", ""],
  em_producao: ["Em produção", "alerta"],
  pronto: ["Pronto", "ok"],
  entregue: ["Entregue", "escuro"],
  cancelado: ["Cancelado", "erro"],
};
const SOLICITACAO: Record<string, [string, string]> = {
  aguardando_pagamento: ["Aguardando comprovante", ""],
  em_conferencia: ["Aguardando conferência", "alerta"],
  aprovada: ["Aprovada", "ok"],
  recusada: ["Recusada", "erro"],
  expirada: ["Prazo vencido", "erro"],
};

export const ROTULO_PRODUCAO = Object.fromEntries(Object.entries(PRODUCAO).map(([k, v]) => [k, v[0]]));

function Selo({ mapa, valor }: { mapa: Record<string, [string, string]>; valor: string }) {
  const [rotulo, classe] = mapa[valor] ?? [valor, ""];
  return <span className={`selo ${classe}`}>{rotulo}</span>;
}

export const SeloPagamento = ({ valor }: { valor: string }) => <Selo mapa={PAGAMENTO} valor={valor} />;
export const SeloProducao = ({ valor }: { valor: string }) => <Selo mapa={PRODUCAO} valor={valor} />;
export const SeloSolicitacao = ({ valor }: { valor: string }) => <Selo mapa={SOLICITACAO} valor={valor} />;

/** Solicitação aguardando comprovante cujo prazo passou aparece como vencida (sem precisar de rotina agendada). */
export function statusVisivel(s: { status: string; comprovante_ate: string }) {
  if (s.status === "aguardando_pagamento" && new Date(s.comprovante_ate) < new Date()) return "expirada";
  return s.status;
}
