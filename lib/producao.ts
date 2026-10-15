export const ETAPAS_TRABALHO: Record<string, string> = {
  massa: "Massa",
  bolear: "Bolear",
  molho: "Molho",
  abrir: "Abrir",
  assar: "Assar",
  embalar: "Embalar",
  limpeza: "Limpeza",
  outro: "Outro",
};
export const ETAPAS_BASE = ["massa", "bolear", "abrir", "assar", "embalar", "limpeza", "outro"];
export const ETAPAS_PREPARO = ["molho", "embalar", "limpeza", "outro"];

export const ESPERAS: Record<string, string> = {
  descanso: "Descanso",
  geladeira: "Geladeira",
  esfriar: "Esfriar",
  freezer: "Freezer",
};
export const ESPERAS_BASE = ["descanso", "geladeira", "esfriar", "freezer"];
export const ESPERAS_PREPARO = ["esfriar", "freezer"];

export const STATUS_LOTE: Record<string, [string, string]> = {
  planejado: ["Planejado", ""],
  em_producao: ["Em produção", "alerta"],
  concluido: ["Concluído", "ok"],
  cancelado: ["Cancelado", "erro"],
};

export interface Sessao { id: string; etapa: string; inicio: string; fim: string | null; manual?: boolean }

/** Minutos trabalhados, contando a sessão aberta até agora. */
export function minutosAtivos(sessoes: Sessao[], agora: number = Date.now()): number {
  return sessoes.reduce((s, x) => s + ((x.fim ? new Date(x.fim).getTime() : agora) - new Date(x.inicio).getTime()) / 60000, 0);
}

export const codigoLote = (n: number) => `L-${String(n).padStart(4, "0")}`;
