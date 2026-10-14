import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirAdmin } from "@/lib/auth";
import { FormAcao } from "@/components/FormAcao";
import { SeloSolicitacao, statusVisivel } from "@/components/Selos";
import { formatarBRL } from "@/lib/dinheiro";
import { formatarData, formatarDataHora } from "@/lib/datas";
import { formatarTelefone, linkWhatsApp } from "@/lib/telefone";
import { aprovar, recusar } from "@/app/admin/pedidos/actions";

export const metadata = { title: "Conferência de pagamento" };

export default async function Conferencia({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await exigirAdmin();
  const { data: s } = await supabase
    .from("solicitacoes")
    .select("*, solicitacao_itens(nome, quantidade, preco_unit_centavos, subtotal_centavos), comprovantes(id, mime, tamanho_bytes, enviado_em), conferencias(decisao, motivo, valor_recebido_centavos, referencia_transacao, decidido_em, admin_id)")
    .eq("id", id)
    .maybeSingle();
  if (!s) notFound();
  const codigo = `S-${String(s.numero).padStart(4, "0")}`;
  const comprovantes = ((s.comprovantes as any[]) ?? []).sort((a, b) => b.enviado_em.localeCompare(a.enviado_em));
  const conf = (s.conferencias as any[])?.[0];
  const decidida = s.status === "aprovada" || s.status === "recusada";
  const agoraSP = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 16);

  return (
    <>
      <div className="cabecalho">
        <div>
          <Link href="/admin/pedidos?aba=conferencia" className="suave">← Conferência</Link>
          <h1>Solicitação {codigo} <SeloSolicitacao valor={statusVisivel(s)} /></h1>
        </div>
        {s.pedido_id && <Link className="botao" href={`/admin/pedidos/${s.pedido_id}`}>Ver pedido</Link>}
      </div>

      <div className="grade" style={{ gap: "1rem", alignItems: "start" }}>
        <div>
          <div className="cartao">
            <h2>Cliente e entrega</h2>
            <p style={{ margin: 0 }}><strong>{s.cliente_nome}</strong></p>
            <p>
              <a href={linkWhatsApp(s.cliente_telefone, `Olá, ${s.cliente_nome.split(" ")[0]}! Aqui é da The Liscia, sobre o seu pedido ${codigo}.`)} target="_blank" rel="noopener">
                {formatarTelefone(s.cliente_telefone)} (WhatsApp)
              </a>
            </p>
            <p style={{ marginBottom: 0 }}>
              {s.modalidade === "entrega" ? "Entrega" : "Retirada"} em <strong>{formatarData(s.entrega_em)}</strong>
              {s.endereco && <><br />{s.endereco}</>}
            </p>
            {s.observacoes && <p className="suave" style={{ marginTop: "0.5rem" }}>Obs.: {s.observacoes}</p>}
            <hr />
            <div className="suave" style={{ fontSize: "0.88rem" }}>
              Campanha {s.campanha_nome} · solicitada em {formatarDataHora(s.criado_em)} · prazo do comprovante {formatarDataHora(s.comprovante_ate)}
            </div>
          </div>
          <div className="cartao">
            <h2>Itens (valores fotografados no pedido)</h2>
            {(s.solicitacao_itens as any[]).map((i, k) => (
              <div key={k} className="linha-total"><span>{i.quantidade}× {i.nome} <span className="suave">({formatarBRL(i.preco_unit_centavos)})</span></span><span className="num">{formatarBRL(i.subtotal_centavos)}</span></div>
            ))}
            <div className="linha-total forte"><span>Total</span><span className="num">{formatarBRL(s.total_centavos)}</span></div>
            <div className="linha-total"><span>Exigido para confirmar ({s.percentual_sinal}%)</span><strong className="num">{formatarBRL(s.sinal_centavos)}</strong></div>
            <div className="linha-total"><span>Saldo na entrega</span><span className="num">{formatarBRL(s.saldo_centavos)}</span></div>
            <p className="suave" style={{ fontSize: "0.85rem", marginTop: "0.5rem", marginBottom: 0 }}>Pix informado ao cliente: {s.pix_chave} ({s.pix_favorecido})</p>
          </div>
        </div>

        <div>
          <div className="cartao">
            <h2>Comprovantes</h2>
            {!comprovantes.length ? <p className="suave">O cliente ainda não enviou comprovante.</p> : comprovantes.map((c) => (
              <div key={c.id} className="linha-total">
                <span>{formatarDataHora(c.enviado_em)} · {c.mime === "application/pdf" ? "PDF" : "imagem"} · {(c.tamanho_bytes / 1024).toFixed(0)} KB</span>
                <a className="botao contorno pequeno" href={`/admin/comprovantes/${c.id}`} target="_blank" rel="noopener">Abrir</a>
              </div>
            ))}
            <p className="suave" style={{ fontSize: "0.85rem", marginTop: "0.5rem", marginBottom: 0 }}>
              O comprovante é só um indício. Confirme no extrato do banco que o valor caiu e que essa transação não foi usada em outro pedido.
            </p>
          </div>

          {decidida && conf ? (
            <div className="cartao">
              <h2>Decisão</h2>
              <p>
                <strong>{conf.decisao === "aprovada" ? "Aprovada" : "Recusada"}</strong> em {formatarDataHora(conf.decidido_em)}
                {conf.valor_recebido_centavos != null && <> · recebido {formatarBRL(conf.valor_recebido_centavos)}</>}
                {conf.referencia_transacao && <> · transação {conf.referencia_transacao}</>}
              </p>
              {conf.motivo && <p className="suave">Motivo: {conf.motivo}</p>}
            </div>
          ) : (
            <>
              <div className="cartao" style={{ borderColor: "var(--verde)" }}>
                <h2>Pix recebido? Aprovar</h2>
                <FormAcao acao={aprovar} botao="Pix recebido, aprovar" classeBotao="largo">
                  <input type="hidden" name="id" value={s.id} />
                  <div className="grade">
                    <div className="campo">
                      <label htmlFor="valor">Valor que caiu na conta (R$)</label>
                      <input id="valor" name="valor" inputMode="decimal" defaultValue={(s.sinal_centavos / 100).toFixed(2).replace(".", ",")} required />
                    </div>
                    <div className="campo">
                      <label htmlFor="recebido_em">Recebido em</label>
                      <input id="recebido_em" name="recebido_em" type="datetime-local" defaultValue={agoraSP} />
                    </div>
                  </div>
                  <div className="campo">
                    <label htmlFor="referencia">Identificação da transação (opcional)</label>
                    <input id="referencia" name="referencia" placeholder="ID/E2E do Pix no extrato" />
                    <span className="ajuda">Se preenchida, o sistema impede usar a mesma transação em outro pedido.</span>
                  </div>
                  <label className="check" style={{ marginBottom: "1rem" }}>
                    <input type="checkbox" name="conferi" required /> Conferi no extrato do banco que o crédito entrou.
                  </label>
                </FormAcao>
              </div>
              <div className="cartao">
                <h2>Recusar</h2>
                <FormAcao acao={recusar} botao="Recusar solicitação" classeBotao="contorno" confirmar="Recusar? A solicitação não vai para a produção.">
                  <input type="hidden" name="id" value={s.id} />
                  <div className="campo">
                    <label htmlFor="motivo">Motivo</label>
                    <input id="motivo" name="motivo" required placeholder="Ex.: Pix não localizado no extrato" />
                  </div>
                </FormAcao>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
