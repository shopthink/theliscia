/** Mini CRM: segmentos, origens, mensagens prontas e CSV. */
import { formatarData } from "./datas";

export const SEGMENTOS: Record<string, { rotulo: string; classe: string; ajuda: string }> = {
  lead: { rotulo: "Lead", classe: "alerta", ajuda: "Começou um pedido e não pagou, ou foi cadastrado à mão" },
  novo: { rotulo: "Novo", classe: "", ajuda: "Fez 1 pedido" },
  recorrente: { rotulo: "Recorrente", classe: "ok", ajuda: "Fez 2 pedidos ou mais" },
  sumido: { rotulo: "Sumido", classe: "erro", ajuda: "Não pede há mais tempo que o limite das configurações" },
};

export const ORIGENS: Record<string, string> = {
  pedido: "Pedido",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  indicacao: "Indicação",
  condominio: "Grupo do condomínio",
  evento: "Evento ou degustação",
  outro: "Outro",
};

export interface CampanhaMsg { entrega_em: string; fecha_em: string }

/** Mensagem de WhatsApp pronta para o segmento. Sem travessões, em tom de conversa. */
export function mensagemSegmento(
  segmento: string,
  nome: string,
  marca: string,
  campanha: CampanhaMsg | null,
  link: string,
): string {
  const n = nome.trim().split(/\s+/)[0] || nome;
  const oi = `Oi, ${n}! Aqui é da ${marca}.`;
  if (campanha) {
    const quando = `entrega em ${formatarData(campanha.entrega_em)}, pedidos até ${formatarData(campanha.fecha_em)}`;
    switch (segmento) {
      case "lead": return `${oi} Vi que você começou um pedido e não finalizou. Ficou alguma dúvida? A rodada está aberta, ${quando}: ${link}`;
      case "sumido": return `${oi} Faz tempo que você não pede, e abriu rodada nova: ${quando}. ${link}`;
      case "recorrente": return `${oi} Rodada nova aberta, ${quando}. Vai querer as de sempre? ${link}`;
      default: return `${oi} Que bom ter você com a gente! Abriu rodada nova, ${quando}: ${link}`;
    }
  }
  switch (segmento) {
    case "lead": return `${oi} Obrigado pelo interesse! Te aviso quando abrir a próxima rodada, combinado?`;
    case "sumido": return `${oi} Faz tempo! Como foram as últimas pizzas? Logo abre rodada nova e te aviso.`;
    case "recorrente": return `${oi} Obrigado por estar sempre com a gente! Logo abre rodada nova e te aviso.`;
    default: return `${oi} Como ficaram as pizzas? Adoraria saber o que você achou.`;
  }
}

/** Etiquetas digitadas separadas por vírgula: sem repetição, minúsculas, até 10. */
export function lerEtiquetas(texto: string): string[] {
  const vistas = new Set<string>();
  for (const t of texto.split(",")) {
    const e = t.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 30);
    if (e) vistas.add(e);
  }
  return [...vistas].slice(0, 10);
}

/** CSV com ; (abre direto no Excel em português) e BOM para acentos. */
export function gerarCSV(cabecalho: string[], linhas: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    // Evita que o Excel interprete o texto como fórmula
    const seguro = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[;"\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
  };
  return "﻿" + [cabecalho, ...linhas].map((l) => l.map(esc).join(";")).join("\r\n");
}
