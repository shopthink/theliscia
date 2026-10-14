/**
 * Pix "copia e cola" estático (BR Code, padrão EMV do Banco Central), com valor e identificador.
 * Não confirma pagamento: só facilita o cliente pagar o valor certo para a chave certa.
 */

function campo(id: string, valor: string) {
  return id + String(valor.length).padStart(2, "0") + valor;
}

/** Remove acentos e caracteres fora do conjunto aceito pelos bancos. */
export function limparTexto(t: string, max: number) {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 .\-@]/g, "")
    .trim()
    .slice(0, max);
}

export function crc16(payload: string) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export interface DadosPix {
  chave: string;
  nome: string;
  cidade: string;
  valorCentavos?: number;
  txid?: string;
}

export function gerarPixCopiaECola({ chave, nome, cidade, valorCentavos, txid }: DadosPix) {
  const gui = campo("00", "br.gov.bcb.pix") + campo("01", chave.trim());
  let p =
    campo("00", "01") +
    campo("26", gui) +
    campo("52", "0000") +
    campo("53", "986") +
    (valorCentavos ? campo("54", (valorCentavos / 100).toFixed(2)) : "") +
    campo("58", "BR") +
    campo("59", limparTexto(nome, 25) || "RECEBEDOR") +
    campo("60", limparTexto(cidade, 15) || "SAO PAULO") +
    campo("62", campo("05", (txid ? txid.replace(/[^A-Za-z0-9]/g, "").slice(0, 25) : "") || "***"));
  p += "6304";
  return p + crc16(p);
}
