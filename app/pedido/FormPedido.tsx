"use client";
import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import type { CampanhaPublica } from "@/lib/publico";
import { formatarBRL } from "@/lib/dinheiro";
import { resumirCarrinho } from "@/lib/carrinho";
import { enviarPedido } from "./actions";

export function FormPedido({ campanha: c }: { campanha: CampanhaPublica }) {
  const [qtd, setQtd] = useState<Record<string, number>>({});
  const [modalidade, setModalidade] = useState<"entrega" | "retirada">(c.permite_retirada && !c.permite_entrega ? "retirada" : "entrega");
  const [estado, enviar] = useActionState(enviarPedido, {});
  const resumo = useMemo(() => resumirCarrinho(c.produtos, qtd, c.pedido_minimo, c.percentual_sinal), [c, qtd]);
  const itens = c.produtos.filter((p) => (qtd[p.id] ?? 0) > 0).map((p) => ({ produto_id: p.id, quantidade: qtd[p.id] }));
  const mudar = (id: string, delta: number) => setQtd((q) => ({ ...q, [id]: Math.min(99, Math.max(0, (q[id] ?? 0) + delta)) }));

  return (
    <form action={enviar}>
      <input type="hidden" name="itens" value={JSON.stringify(itens)} />
      <div className="cartao">
        <h2>1. Escolha as bases</h2>
        {c.produtos.map((p) => (
          <div className="produto" key={p.id}>
            {p.foto_url && <img src={p.foto_url} alt="" />}
            <div style={{ flex: 1 }}>
              <div className="nome">{p.nome}</div>
              {p.descricao && <div className="suave" style={{ fontSize: "0.92rem" }}>{p.descricao}</div>}
              <div className="preco">{formatarBRL(p.preco_centavos)} <span className="suave">por base</span></div>
            </div>
            <div className="contador-qtd" aria-label={`Quantidade de ${p.nome}`}>
              <button type="button" className="contorno" onClick={() => mudar(p.id, -1)} aria-label="Menos" disabled={!qtd[p.id]}>−</button>
              <output aria-live="polite">{qtd[p.id] ?? 0}</output>
              <button type="button" onClick={() => mudar(p.id, 1)} aria-label="Mais">+</button>
            </div>
          </div>
        ))}
        {!resumo.atingiuMinimo && resumo.bases > 0 && (
          <div className="aviso alerta" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
            Faltam {resumo.faltam} {resumo.faltam === 1 ? "base" : "bases"} para o pedido mínimo de {c.pedido_minimo}.
          </div>
        )}
      </div>

      <div className="cartao">
        <h2>2. Seus dados</h2>
        <div className="campo">
          <label htmlFor="nome">Nome</label>
          <input id="nome" name="nome" autoComplete="name" required maxLength={120} />
        </div>
        <div className="campo">
          <label htmlFor="telefone">WhatsApp com DDD</label>
          <input id="telefone" name="telefone" type="tel" inputMode="tel" autoComplete="tel" placeholder="(11) 90000-0000" required />
        </div>
        {c.permite_entrega && c.permite_retirada && (
          <div className="campo">
            <label>Como prefere receber?</label>
            <div className="acoes">
              <label className="check"><input type="radio" name="modalidade" value="entrega" checked={modalidade === "entrega"} onChange={() => setModalidade("entrega")} /> Entrega</label>
              <label className="check"><input type="radio" name="modalidade" value="retirada" checked={modalidade === "retirada"} onChange={() => setModalidade("retirada")} /> Retirada</label>
            </div>
          </div>
        )}
        {!(c.permite_entrega && c.permite_retirada) && <input type="hidden" name="modalidade" value={modalidade} />}
        {modalidade === "entrega" ? (
          <>
            <div className="campo">
              <label htmlFor="endereco">Endereço de entrega</label>
              <textarea id="endereco" name="endereco" autoComplete="street-address" required maxLength={300} placeholder="Rua, número, complemento e bairro" />
            </div>
            {(c.regiao_atendida || c.instrucoes_entrega) && (
              <div className="aviso info">
                {c.regiao_atendida && <div><strong>Região atendida:</strong> {c.regiao_atendida}</div>}
                {c.instrucoes_entrega && <div style={{ whiteSpace: "pre-line" }}>{c.instrucoes_entrega}</div>}
              </div>
            )}
          </>
        ) : (
          c.retirada_info && <div className="aviso info" style={{ whiteSpace: "pre-line" }}><strong>Retirada:</strong> {c.retirada_info}</div>
        )}
        <div className="aviso info"><strong>Frete:</strong> {c.frete_info || "não há cobrança de frete neste pedido."}</div>
        <div className="campo">
          <label htmlFor="observacoes">Observações (opcional)</label>
          <textarea id="observacoes" name="observacoes" maxLength={500} />
        </div>
      </div>

      <div className="cartao">
        <h2>3. Resumo</h2>
        <div className="linha-total"><span>{resumo.bases} {resumo.bases === 1 ? "base" : "bases"}</span><span className="num">{formatarBRL(resumo.total)}</span></div>
        {c.percentual_sinal < 100 ? (
          <>
            <div className="linha-total forte"><span>Sinal de {c.percentual_sinal}% no Pix agora</span><span className="num">{formatarBRL(resumo.sinal)}</span></div>
            <div className="linha-total suave"><span>Saldo na entrega</span><span className="num">{formatarBRL(resumo.saldo)}</span></div>
          </>
        ) : (
          <div className="linha-total forte"><span>Total no Pix</span><span className="num">{formatarBRL(resumo.total)}</span></div>
        )}
        <p className="suave" style={{ fontSize: "0.88rem", marginTop: "0.6rem", marginBottom: 0 }}>
          No próximo passo você vê a chave Pix e envia o comprovante. O pedido é confirmado depois que conferirmos o pagamento.
        </p>
      </div>

      {estado.erro && <div className="aviso erro" role="alert">{estado.erro}</div>}
      <div className="barra-total">
        <div>
          <div style={{ fontSize: "0.8rem", opacity: 0.8 }}>{resumo.bases} {resumo.bases === 1 ? "base" : "bases"}</div>
          <div style={{ fontWeight: 600, fontSize: "1.15rem" }} className="num">{formatarBRL(resumo.total)}</div>
        </div>
        <Enviar desabilitado={!resumo.atingiuMinimo} />
      </div>
    </form>
  );
}

function Enviar({ desabilitado }: { desabilitado: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={desabilitado || pending}>
      {pending ? "Gerando…" : "Ir para o pagamento"}
    </button>
  );
}
