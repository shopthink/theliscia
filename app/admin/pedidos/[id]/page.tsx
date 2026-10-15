import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirAdmin } from "@/lib/auth";
import { FormAcao } from "@/components/FormAcao";
import { ROTULO_PRODUCAO, SeloPagamento, SeloProducao } from "@/components/Selos";
import { formatarBRL } from "@/lib/dinheiro";
import { formatarData, formatarDataHora } from "@/lib/datas";
import { formatarTelefone, linkWhatsApp } from "@/lib/telefone";
import { localEntrega } from "@/lib/condominios";
import { mudarStatusProducao, registrarPagamento, removerPagamento } from "../actions";

export const metadata = { title: "Pedido" };

const METODO: Record<string, string> = { pix: "Pix", dinheiro: "Dinheiro", cartao: "Cartão", outro: "Outro" };

export default async function Pedido({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ aprovado?: string; criado?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await exigirAdmin();
  const { data: p } = await supabase
    .from("pedidos")
    .select("*, pedido_itens(id, nome, quantidade, preco_unit_centavos, subtotal_centavos, receita_versao_id, receita_versoes(numero)), pagamentos(id, valor_centavos, recebido_em, metodo, referencia, solicitacao_id), campanhas(nome), solicitacoes!pedidos_solicitacao_id_fkey(numero)")
    .eq("id", id)
    .maybeSingle();
  if (!p) notFound();
  const codigo = `#${String(p.numero).padStart(4, "0")}`;
  const saldo = p.total_centavos - p.recebido_centavos;
  const pagamentos = ((p.pagamentos as any[]) ?? []).sort((a, b) => a.recebido_em.localeCompare(b.recebido_em));
  const agoraSP = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 16);
  const sol = p.solicitacoes as any;

  return (
    <>
      <div className="cabecalho">
        <div>
          <Link href="/admin/pedidos" className="suave">← Pedidos</Link>
          <h1>Pedido {codigo}</h1>
          <div className="acoes" style={{ marginTop: "0.35rem" }}><SeloPagamento valor={p.status_pagamento} /><SeloProducao valor={p.status_producao} /></div>
        </div>
      </div>
      <div className="acoes" style={{ marginBottom: "1rem" }}>
        <Link className="botao contorno" href={`/admin/etiquetas?pedido=${p.id}`}>🏷 Imprimir etiquetas</Link>
      </div>
      {sp.aprovado && <div className="aviso ok">Pagamento aprovado. O pedido entrou na lista de produção.</div>}
      {sp.criado && <div className="aviso ok">Pedido criado.</div>}

      <div className="grade" style={{ gap: "1rem", alignItems: "start" }}>
        <div>
          <div className="cartao">
            <h2>Cliente e entrega</h2>
            <p style={{ margin: 0 }}><strong>{p.cliente_nome}</strong></p>
            <p><a href={linkWhatsApp(p.cliente_telefone)} target="_blank" rel="noopener">{formatarTelefone(p.cliente_telefone)} (WhatsApp)</a></p>
            <p style={{ marginBottom: 0 }}>
              {p.modalidade === "entrega" ? "Entrega" : "Retirada"} em <strong>{formatarData(p.entrega_em)}</strong>
              {p.condominio_nome && <><br /><strong>{localEntrega(p)}</strong></>}
              {p.endereco && <><br />{p.endereco}</>}
            </p>
            {p.observacoes && <p className="suave" style={{ marginTop: "0.5rem" }}>Obs.: {p.observacoes}</p>}
            <hr />
            <div className="suave" style={{ fontSize: "0.88rem" }}>
              Origem: {p.origem === "link" ? <>link público {sol && <Link href={`/admin/conferencia/${p.solicitacao_id}`}>(S-{String(sol.numero).padStart(4, "0")})</Link>}</> : "manual"}
              {(p.campanhas as any)?.nome && <> · campanha {(p.campanhas as any).nome}</>} · criado em {formatarDataHora(p.criado_em)}
            </div>
          </div>
          <div className="cartao">
            <h2>Itens</h2>
            {(p.pedido_itens as any[]).map((i) => (
              <div key={i.id} className="linha-total">
                <span>{i.quantidade}× {i.nome} <span className="suave">({formatarBRL(i.preco_unit_centavos)} · receita v{i.receita_versoes?.numero})</span></span>
                <span className="num">{formatarBRL(i.subtotal_centavos)}</span>
              </div>
            ))}
            {p.taxa_entrega_centavos > 0 && <div className="linha-total"><span>Taxa de entrega</span><span className="num">{formatarBRL(p.taxa_entrega_centavos)}</span></div>}
            <div className="linha-total forte"><span>Total</span><span className="num">{formatarBRL(p.total_centavos)}</span></div>
          </div>
          <div className="cartao">
            <h2>Produção e entrega</h2>
            <FormAcao acao={mudarStatusProducao} botao="Atualizar">
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="versao" value={p.versao} />
              <div className="campo">
                <label htmlFor="status">Status</label>
                <select id="status" name="status" defaultValue={p.status_producao}>
                  {Object.entries(ROTULO_PRODUCAO).map(([v, r]) => <option key={v} value={v}>{r as string}</option>)}
                </select>
                <span className="ajuda">A venda é reconhecida no mês da entrega. Em produção e Pronto mudam sozinhos pelos lotes.</span>
              </div>
            </FormAcao>
          </div>
        </div>

        <div>
          <div className="cartao">
            <h2>Pagamentos</h2>
            <div className="linha-total"><span>Total do pedido</span><span className="num">{formatarBRL(p.total_centavos)}</span></div>
            <div className="linha-total"><span>Recebido</span><span className="num">{formatarBRL(p.recebido_centavos)}</span></div>
            <div className="linha-total forte"><span>Saldo</span><span className="num" style={{ color: saldo > 0 ? "var(--bordo)" : undefined }}>{formatarBRL(saldo)}</span></div>
            {pagamentos.length > 0 && (
              <div className="tabela-rolagem" style={{ marginTop: "0.75rem" }}>
                <table>
                  <thead><tr><th>Data</th><th>Forma</th><th className="dir">Valor</th><th></th></tr></thead>
                  <tbody>
                    {pagamentos.map((g) => (
                      <tr key={g.id}>
                        <td className="num">{formatarDataHora(g.recebido_em)}{g.referencia && <div className="suave" style={{ fontSize: "0.8rem" }}>{g.referencia}</div>}</td>
                        <td>{METODO[g.metodo] ?? g.metodo}{g.solicitacao_id && <div className="suave" style={{ fontSize: "0.8rem" }}>conferido</div>}</td>
                        <td className="dir num">{formatarBRL(g.valor_centavos)}</td>
                        <td className="dir">
                          {!g.solicitacao_id && (
                            <FormAcao acao={removerPagamento} botao="Remover" classeBotao="contorno pequeno" confirmar="Remover este pagamento?">
                              <input type="hidden" name="id" value={g.id} />
                              <input type="hidden" name="pedido_id" value={p.id} />
                            </FormAcao>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {saldo > 0 && p.status_producao !== "cancelado" && (
            <div className="cartao">
              <h2>Registrar recebimento</h2>
              <FormAcao acao={registrarPagamento} botao="Registrar" limparAoSalvar>
                <input type="hidden" name="pedido_id" value={p.id} />
                <div className="grade">
                  <div className="campo">
                    <label htmlFor="valor">Valor (R$)</label>
                    <input id="valor" name="valor" inputMode="decimal" defaultValue={(saldo / 100).toFixed(2).replace(".", ",")} required />
                  </div>
                  <div className="campo">
                    <label htmlFor="metodo">Forma</label>
                    <select id="metodo" name="metodo" defaultValue="pix">
                      {Object.entries(METODO).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grade">
                  <div className="campo">
                    <label htmlFor="recebido_em">Recebido em</label>
                    <input id="recebido_em" name="recebido_em" type="datetime-local" defaultValue={agoraSP} />
                  </div>
                  <div className="campo">
                    <label htmlFor="referencia">Identificação (opcional)</label>
                    <input id="referencia" name="referencia" />
                  </div>
                </div>
              </FormAcao>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
