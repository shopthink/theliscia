/** Mensagens de regra de negócio vêm do banco com código P0001; o resto vira mensagem genérica. */
export function mensagemDoBanco(e: { code?: string; message?: string } | null | undefined, padrao = "Não foi possível salvar. Tente novamente."): string {
  if (!e) return padrao;
  if (e.code === "P0001" && e.message) return e.message;
  if (e.code === "23505") {
    if (e.message?.includes("campanhas_uma_ativa")) return "Já existe outra campanha ativa. Pause-a antes de ativar esta.";
    if (e.message?.includes("pagamentos_referencia_unica")) return "Esta identificação de transação já foi usada em outro pagamento.";
    if (e.message?.includes("insumos_nome")) return "Já existe um insumo com esse nome.";
    return "Registro duplicado.";
  }
  if (e.code === "23514") {
    if (e.message?.includes("campanha_datas_abertura")) return "A abertura não pode ser depois do encerramento.";
    if (e.message?.includes("campanha_datas_entrega")) return "A entrega não pode ser antes do encerramento dos pedidos.";
    if (e.message?.includes("campanha_modalidade")) return "Permita entrega, retirada ou as duas.";
    return "Algum valor está fora do permitido.";
  }
  if (e.code === "42501") return "Acesso negado.";
  return padrao;
}

export interface EstadoForm {
  erro?: string;
  ok?: string;
  dados?: Record<string, unknown>;
}

export const CONFLITO = "Este registro foi alterado em outra aba ou dispositivo. Recarregue a página e tente de novo.";
