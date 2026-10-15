import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { clienteServico } from "@/lib/supabase/servico";
import { carregarContato, TOKEN_VALIDO } from "@/lib/publico";
import { formatarBRL } from "@/lib/dinheiro";
import { formatarData, formatarDataExtenso, formatarDataHora } from "@/lib/datas";
import { gerarPixCopiaECola } from "@/lib/pix";
import { Copiar } from "@/components/Copiar";
import { localEntrega } from "@/lib/condominios";
import { TopoPublico, RodapePublico } from "@/components/Publico";
import { EnvioComprovante } from "./EnvioComprovante";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pagamento do pedido", robots: { index: false, follow: false } };

export default async function PagamentoPedido({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_VALIDO.test(token)) notFound();
  const sb = clienteServico();
  // Só os campos que o próprio cliente informou ou viu. O token não é previsível.
  const { data: s } = await sb
    .from("solicitacoes")
    .select("id, numero, campanha_nome, cliente_nome, modalidade, endereco, condominio_nome, bloco, apto, taxa_entrega_centavos, entrega_em, pix_chave, pix_favorecido, pix_cidade, percentual_sinal, total_centavos, sinal_centavos, saldo_centavos, total_bases, status, comprovante_ate, solicitacao_itens(nome, quantidade, preco_unit_centavos, subtotal_centavos), comprovantes(enviado_em)")
    .eq("token", token)
    .maybeSingle();
  if (!s) notFound();
  const contato = await carregarContato();

  const codigo = `#${String(s.numero).padStart(4, "0")}`;
  const vencido = s.status === "aguardando_pagamento" && new Date(s.comprovante_ate) < new Date();
  const podeEnviar = (s.status === "aguardando_pagamento" || s.status === "em_conferencia") && new Date(s.comprovante_ate) >= new Date();
  const pix = gerarPixCopiaECola({
    chave: s.pix_chave,
    nome: s.pix_favorecido,
    cidade: s.pix_cidade,
    valorCentavos: s.sinal_centavos,
    txid: `LISCIA${String(s.numero).padStart(4, "0")}`,
  });
  const qr = await QRCode.toString(pix, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#29392F", light: "#FFFFFF" } });
  const enviados = (s.comprovantes as any[]) ?? [];

  return (
    <div className="publico">
      <TopoPublico chamada={`Pedido ${codigo}`} />
      <main className="miolo-publico">
        {s.status === "aprovada" && (
          <div className="aviso ok"><strong>Pagamento confirmado.</strong> Seu pedido está na produção para {formatarDataExtenso(s.entrega_em)}.</div>
        )}
        {s.status === "recusada" && (
          <div className="aviso erro"><strong>Não conseguimos confirmar este pagamento.</strong> Fale com a gente pelo WhatsApp para resolver.</div>
        )}
        {s.status === "em_conferencia" && (
          <div className="aviso alerta">
            <strong>Comprovante recebido, em análise.</strong> Vamos conferir o Pix no banco e confirmar pelo WhatsApp informado.
            Enviar o comprovante ainda não confirma o pedido.
          </div>
        )}
        {vencido && (
          <div className="aviso erro">O prazo para enviar o comprovante terminou em {formatarDataHora(s.comprovante_ate)}. Se você já pagou, fale com a gente pelo WhatsApp.</div>
        )}

        {s.status === "aguardando_pagamento" && !vencido && (
          <div className="cartao">
            <h1 style={{ fontSize: "1.35rem" }}>Falta pouco, {s.cliente_nome.split(" ")[0]}</h1>
            <ol className="passos">
              <li>Pague <strong>{formatarBRL(s.sinal_centavos)}</strong> no Pix{s.percentual_sinal < 100 ? ` (sinal de ${s.percentual_sinal}%)` : ""}.</li>
              <li>Confira se o favorecido é <strong>{s.pix_favorecido}</strong>.</li>
              <li>Envie o comprovante aqui embaixo até {formatarDataHora(s.comprovante_ate)}.</li>
            </ol>
          </div>
        )}

        {s.status === "aguardando_pagamento" && !vencido && (
          <div className="cartao">
            <h2>Pix</h2>
            <div className="linha-total forte" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
              <span>Valor a pagar agora</span><span className="num">{formatarBRL(s.sinal_centavos)}</span>
            </div>
            <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} />
            <div className="campo">
              <label>Pix copia e cola (já com o valor)</label>
              <div className="pix-chave">{pix}</div>
              <div style={{ marginTop: "0.5rem" }}><Copiar texto={pix} rotulo="Copiar código Pix" className="largo" /></div>
            </div>
            <div className="campo">
              <label>Ou use a chave</label>
              <div className="acoes"><div className="pix-chave" style={{ flex: 1 }}>{s.pix_chave}</div><Copiar texto={s.pix_chave} rotulo="Copiar chave" /></div>
              <span className="ajuda">Favorecido: <strong>{s.pix_favorecido}</strong></span>
            </div>
          </div>
        )}

        {podeEnviar && (
          <div className="cartao">
            <h2>{enviados.length ? "Enviar outro comprovante" : "Enviar comprovante"}</h2>
            {enviados.length > 0 && <p className="suave">Recebemos {enviados.length} {enviados.length === 1 ? "arquivo" : "arquivos"}. Só envie outro se o primeiro estiver errado.</p>}
            <EnvioComprovante token={token} />
          </div>
        )}

        <div className="cartao">
          <h2>Resumo do pedido {codigo}</h2>
          {(s.solicitacao_itens as any[]).map((i, k) => (
            <div className="linha-total" key={k}>
              <span>{i.quantidade}× {i.nome}</span><span className="num">{formatarBRL(i.subtotal_centavos)}</span>
            </div>
          ))}
          {s.modalidade === "entrega" && (
            <div className="linha-total"><span>Entrega</span><span className="num">{s.taxa_entrega_centavos > 0 ? formatarBRL(s.taxa_entrega_centavos) : "grátis"}</span></div>
          )}
          <div className="linha-total forte"><span>Total</span><span className="num">{formatarBRL(s.total_centavos)}</span></div>
          {s.percentual_sinal < 100 && (
            <>
              <div className="linha-total"><span>Sinal no Pix</span><span className="num">{formatarBRL(s.sinal_centavos)}</span></div>
              <div className="linha-total"><span>Saldo na entrega</span><span className="num">{formatarBRL(s.saldo_centavos)}</span></div>
            </>
          )}
          <hr />
          <p style={{ margin: 0 }}>
            <strong>{s.modalidade === "entrega" ? "Entrega" : "Retirada"}</strong> em {formatarData(s.entrega_em)}
            {s.condominio_nome ? <><br /><span className="suave">{localEntrega(s)}</span></> : s.endereco ? <><br /><span className="suave">{s.endereco}</span></> : null}
          </p>
        </div>
        <p className="suave" style={{ fontSize: "0.85rem", textAlign: "center" }}>Guarde este link para acompanhar seu pedido.</p>
      </main>
      <RodapePublico whatsapp={contato?.whatsapp_contato} instagram={contato?.instagram} />
    </div>
  );
}
