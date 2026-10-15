/* Campos do formulário de campanha (novo e edição). */
export interface CampanhaForm {
  nome?: string;
  abre_em?: string;
  fecha_em?: string;
  entrega_em?: string;
  permite_entrega?: boolean;
  permite_retirada?: boolean;
  permite_condominios?: boolean;
  taxa_entrega_centavos?: number;
  instrucoes_entrega?: string | null;
  regiao_atendida?: string | null;
  retirada_info?: string | null;
  frete_info?: string | null;
  pedido_minimo?: number;
  pix_chave?: string | null;
  pix_favorecido?: string | null;
  pix_cidade?: string | null;
  percentual_sinal?: number;
  horas_envio_comprovante?: number;
}

export function CamposCampanha({ c }: { c: CampanhaForm }) {
  return (
    <>
      <h2>Identificação e datas</h2>
      <div className="grade">
        <div className="campo">
          <label htmlFor="nome">Nome da campanha</label>
          <input id="nome" name="nome" defaultValue={c.nome ?? ""} placeholder="Outubro/2026" required maxLength={80} />
        </div>
        <div className="campo">
          <label htmlFor="pedido_minimo">Pedido mínimo (bases, somando os tipos)</label>
          <input id="pedido_minimo" name="pedido_minimo" type="number" min={1} max={100} defaultValue={c.pedido_minimo ?? 3} required />
        </div>
      </div>
      <div className="grade">
        <div className="campo">
          <label htmlFor="abre_em">Abre para pedidos em</label>
          <input id="abre_em" name="abre_em" type="date" defaultValue={c.abre_em ?? ""} required />
        </div>
        <div className="campo">
          <label htmlFor="fecha_em">Último dia para pedir</label>
          <input id="fecha_em" name="fecha_em" type="date" defaultValue={c.fecha_em ?? ""} required />
          <span className="ajuda">Aceita pedidos até 23h59 (horário de São Paulo).</span>
        </div>
        <div className="campo">
          <label htmlFor="entrega_em">Entrega ou retirada em</label>
          <input id="entrega_em" name="entrega_em" type="date" defaultValue={c.entrega_em ?? ""} required />
          <span className="ajuda">O cliente não escolhe a data: recebe esta.</span>
        </div>
      </div>

      <h2>Entrega e retirada</h2>
      <div className="acoes" style={{ marginBottom: "0.9rem" }}>
        <label className="check"><input type="checkbox" name="permite_condominios" defaultChecked={c.permite_condominios ?? true} /> Entrega nos condomínios parceiros (grátis)</label>
        <label className="check"><input type="checkbox" name="permite_entrega" defaultChecked={c.permite_entrega ?? true} /> Entrega em outros endereços</label>
        <label className="check"><input type="checkbox" name="permite_retirada" defaultChecked={c.permite_retirada ?? false} /> Cliente pode retirar</label>
      </div>
      <div className="grade">
        <div className="campo">
          <label htmlFor="taxa_entrega">Taxa de entrega fora de condomínio (R$)</label>
          <input id="taxa_entrega" name="taxa_entrega" inputMode="decimal" placeholder="0,00"
            defaultValue={c.taxa_entrega_centavos ? (c.taxa_entrega_centavos / 100).toFixed(2).replace(".", ",") : ""} />
          <span className="ajuda">Somada ao total e ao Pix. Condomínio parceiro e retirada não pagam.</span>
        </div>
        <div className="campo">
          <label htmlFor="regiao_atendida">Região atendida</label>
          <input id="regiao_atendida" name="regiao_atendida" defaultValue={c.regiao_atendida ?? ""} placeholder="Ex.: bairros onde você entrega" />
        </div>
        <div className="campo">
          <label htmlFor="frete_info">Aviso sobre entrega (opcional)</label>
          <input id="frete_info" name="frete_info" defaultValue={c.frete_info ?? ""} placeholder="Ex.: fora da região, combinamos pelo WhatsApp" />
        </div>
      </div>
      <div className="grade">
        <div className="campo">
          <label htmlFor="instrucoes_entrega">Instruções de entrega</label>
          <textarea id="instrucoes_entrega" name="instrucoes_entrega" defaultValue={c.instrucoes_entrega ?? ""} />
        </div>
        <div className="campo">
          <label htmlFor="retirada_info">Retirada (local e horário)</label>
          <textarea id="retirada_info" name="retirada_info" defaultValue={c.retirada_info ?? ""} />
        </div>
      </div>

      <h2>Pix</h2>
      <div className="grade">
        <div className="campo">
          <label htmlFor="pix_chave">Chave Pix</label>
          <input id="pix_chave" name="pix_chave" defaultValue={c.pix_chave ?? ""} autoComplete="off" />
        </div>
        <div className="campo">
          <label htmlFor="pix_favorecido">Nome do favorecido</label>
          <input id="pix_favorecido" name="pix_favorecido" defaultValue={c.pix_favorecido ?? ""} />
          <span className="ajuda">Como aparece no app do banco, para o cliente conferir.</span>
        </div>
        <div className="campo">
          <label htmlFor="pix_cidade">Cidade do favorecido</label>
          <input id="pix_cidade" name="pix_cidade" defaultValue={c.pix_cidade ?? "Sao Paulo"} maxLength={40} />
          <span className="ajuda">Usada no Pix copia e cola.</span>
        </div>
      </div>
      <div className="grade">
        <div className="campo">
          <label htmlFor="percentual_sinal">Para confirmar o pedido</label>
          <select id="percentual_sinal" name="percentual_sinal" defaultValue={String(c.percentual_sinal ?? 100)}>
            <option value="100">100% no Pix</option>
            <option value="50">50% de sinal, saldo na entrega</option>
          </select>
        </div>
        <div className="campo">
          <label htmlFor="horas_envio_comprovante">Prazo para enviar o comprovante (horas)</label>
          <input id="horas_envio_comprovante" name="horas_envio_comprovante" type="number" min={1} max={168} defaultValue={c.horas_envio_comprovante ?? 24} />
          <span className="ajuda">Contado a partir do momento em que o cliente gera o pedido, mesmo que a janela feche nesse intervalo.</span>
        </div>
      </div>
    </>
  );
}
