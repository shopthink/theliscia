import { ORIGENS } from "@/lib/crm";

export interface ClienteForm {
  nome?: string;
  origem?: string | null;
  anotacoes?: string | null;
  etiquetas?: string[];
  condominio_id?: string | null;
  bloco?: string | null;
  apto?: string | null;
  aceita_novidades?: boolean;
}

export function CamposCliente({ c, condominios, novo = false }: { c: ClienteForm; condominios: { id: string; nome: string }[]; novo?: boolean }) {
  return (
    <>
      <div className="grade">
        <div className="campo"><label htmlFor="nome">Nome</label><input id="nome" name="nome" defaultValue={c.nome ?? ""} required maxLength={120} /></div>
        {novo && <div className="campo"><label htmlFor="telefone">WhatsApp com DDD</label><input id="telefone" name="telefone" type="tel" required /></div>}
        <div className="campo">
          <label htmlFor="origem">Como chegou</label>
          <select id="origem" name="origem" defaultValue={c.origem ?? (novo ? "whatsapp" : "pedido")}>
            {Object.entries(ORIGENS).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
        </div>
      </div>
      <div className="grade">
        <div className="campo">
          <label htmlFor="condominio_id">Condomínio</label>
          <select id="condominio_id" name="condominio_id" defaultValue={c.condominio_id ?? ""}>
            <option value="">Nenhum</option>
            {condominios.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
          </select>
        </div>
        <div className="campo"><label htmlFor="bloco">Bloco</label><input id="bloco" name="bloco" defaultValue={c.bloco ?? ""} maxLength={20} /></div>
        <div className="campo"><label htmlFor="apto">Apto ou casa</label><input id="apto" name="apto" defaultValue={c.apto ?? ""} maxLength={20} /></div>
      </div>
      <div className="campo">
        <label htmlFor="etiquetas">Etiquetas (separe por vírgula)</label>
        <input id="etiquetas" name="etiquetas" defaultValue={(c.etiquetas ?? []).join(", ")} placeholder="Ex.: embaixador, prefere NY, buffet" />
      </div>
      <div className="campo">
        <label htmlFor="anotacoes">Anotações</label>
        <textarea id="anotacoes" name="anotacoes" defaultValue={c.anotacoes ?? ""} maxLength={2000} placeholder="Preferências, combinados, como conheceu…" />
      </div>
      <label className="check" style={{ marginBottom: "1rem" }}>
        <input type="checkbox" name="aceita_novidades" defaultChecked={c.aceita_novidades ?? false} /> Aceita receber avisos e novidades pelo WhatsApp
      </label>
      <p className="ajuda" style={{ marginTop: "-0.6rem" }}>Marque só se a pessoa concordou (LGPD). Só quem aceitou entra nas listas de divulgação.</p>
    </>
  );
}
