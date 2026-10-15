/* Campos do formulário de condomínio (novo e edição). */
export interface CondominioForm {
  nome?: string;
  slug?: string;
  endereco?: string;
  forma_entrega?: string;
  janela_entrega?: string | null;
  instrucoes_cliente?: string | null;
  notas_internas?: string | null;
  meta_bases?: number | null;
  ativo?: boolean;
}

export function CamposCondominio({ c, edicao = false }: { c: CondominioForm; edicao?: boolean }) {
  return (
    <>
      <div className="grade">
        <div className="campo">
          <label htmlFor="nome">Nome</label>
          <input id="nome" name="nome" defaultValue={c.nome ?? ""} required maxLength={80} placeholder="Ex.: Residencial Jardins" />
        </div>
        <div className="campo">
          <label htmlFor="slug">Final do link</label>
          <input id="slug" name="slug" defaultValue={c.slug ?? ""} maxLength={40} placeholder={edicao ? "" : "gerado pelo nome"} />
          <span className="ajuda">O link fica /pedido?c=<strong>{c.slug || "jardins"}</strong>. Mudar quebra o link que já foi divulgado.</span>
        </div>
      </div>
      <div className="campo">
        <label htmlFor="endereco">Endereço</label>
        <input id="endereco" name="endereco" defaultValue={c.endereco ?? ""} required maxLength={300} placeholder="Rua, número e bairro" />
      </div>
      <div className="grade">
        <div className="campo">
          <label htmlFor="forma_entrega">Como entrego</label>
          <select id="forma_entrega" name="forma_entrega" defaultValue={c.forma_entrega ?? "portaria"}>
            <option value="portaria">Na portaria, em horário marcado</option>
            <option value="porta">Na porta do apartamento</option>
          </select>
        </div>
        <div className="campo">
          <label htmlFor="janela_entrega">Horário (opcional)</label>
          <input id="janela_entrega" name="janela_entrega" defaultValue={c.janela_entrega ?? ""} maxLength={120} placeholder="Ex.: das 10h às 12h" />
          <span className="ajuda">A data vem da campanha.</span>
        </div>
        <div className="campo">
          <label htmlFor="meta_bases">Meta coletiva (bases, opcional)</label>
          <input id="meta_bases" name="meta_bases" type="number" min={1} max={500} defaultValue={c.meta_bases ?? ""} />
          <span className="ajuda">Mostra para os moradores quantas bases faltam.</span>
        </div>
      </div>
      <div className="grade">
        <div className="campo">
          <label htmlFor="instrucoes_cliente">Instruções para o morador</label>
          <textarea id="instrucoes_cliente" name="instrucoes_cliente" defaultValue={c.instrucoes_cliente ?? ""} maxLength={500} placeholder="Ex.: desça na portaria quando avisarmos no WhatsApp" />
        </div>
        <div className="campo">
          <label htmlFor="notas_internas">Notas só para você</label>
          <textarea id="notas_internas" name="notas_internas" defaultValue={c.notas_internas ?? ""} maxLength={1000} placeholder="Ex.: falar com o porteiro, estacionar na rua lateral" />
        </div>
      </div>
      {edicao && (
        <label className="check" style={{ marginBottom: "1rem" }}>
          <input type="checkbox" name="ativo" defaultChecked={c.ativo ?? true} /> Ativo (aparece para os clientes e aceita pedidos)
        </label>
      )}
    </>
  );
}
