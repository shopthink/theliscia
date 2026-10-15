"use client";
import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import type { CampanhaPublica, CondominioPublico } from "@/lib/publico";
import { FORMA_ENTREGA } from "@/lib/condominios";
import { formatarBRL } from "@/lib/dinheiro";
import { resumirCarrinho } from "@/lib/carrinho";
import { enviarPedido } from "./actions";

type Tipo = "condominio" | "entrega" | "retirada";

export function FormPedido({ campanha: c, condominios, fixo }: { campanha: CampanhaPublica; condominios: CondominioPublico[]; fixo: CondominioPublico | null }) {
  const [qtd, setQtd] = useState<Record<string, number>>({});
  const podeCondominio = c.permite_condominios && (fixo != null || condominios.length > 0);
  const disponiveis: Tipo[] = [
    ...(podeCondominio ? (["condominio"] as const) : []),
    ...(c.permite_entrega ? (["entrega"] as const) : []),
    ...(c.permite_retirada ? (["retirada"] as const) : []),
  ];
  const [tipo, setTipo] = useState<Tipo>(fixo ? "condominio" : disponiveis.find((t) => t === "entrega") ?? disponiveis[0] ?? "entrega");
  const [condoId, setCondoId] = useState("");
  const condo = fixo ?? condominios.find((x) => x.id === condoId) ?? null;
  const taxa = tipo === "entrega" ? c.taxa_entrega_centavos : 0;
  const [estado, enviar] = useActionState(enviarPedido, {});
  const resumo = useMemo(() => resumirCarrinho(c.produtos, qtd, c.pedido_minimo, c.percentual_sinal, taxa), [c, qtd, taxa]);
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
        <div className="campo">
          <label>Como prefere receber?</label>
          <div className="opcoes-receber">
            {podeCondominio && (
              <label className="opcao-receber">
                <input type="radio" name="tipo" value="condominio" checked={tipo === "condominio"} onChange={() => setTipo("condominio")} />
                <span>{fixo ? `Entrega no ${fixo.nome}` : "Moro em condomínio atendido"} <small>Grátis · você informa só bloco e apartamento</small></span>
              </label>
            )}
            {c.permite_entrega && (
              <label className="opcao-receber">
                <input type="radio" name="tipo" value="entrega" checked={tipo === "entrega"} onChange={() => setTipo("entrega")} />
                <span>Entrega no meu endereço <small>{c.taxa_entrega_centavos > 0 ? `Taxa de ${formatarBRL(c.taxa_entrega_centavos)}` : "Sem taxa"}{c.regiao_atendida ? ` · ${c.regiao_atendida}` : ""}</small></span>
              </label>
            )}
            {c.permite_retirada && (
              <label className="opcao-receber">
                <input type="radio" name="tipo" value="retirada" checked={tipo === "retirada"} onChange={() => setTipo("retirada")} />
                <span>Retirada <small>Sem taxa</small></span>
              </label>
            )}
          </div>
        </div>
        {tipo === "condominio" && (
          <>
            {fixo ? (
              <input type="hidden" name="condominio_id" value={fixo.id} />
            ) : (
              <div className="campo">
                <label htmlFor="condominio_id">Condomínio</label>
                <select id="condominio_id" name="condominio_id" required value={condoId} onChange={(e) => setCondoId(e.target.value)}>
                  <option value="">Escolha…</option>
                  {condominios.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                </select>
                <span className="ajuda">Não achou o seu? Escolha entrega no endereço.</span>
              </div>
            )}
            <div className="grade">
              <div className="campo">
                <label htmlFor="bloco">Bloco ou torre (se tiver)</label>
                <input id="bloco" name="bloco" maxLength={20} autoComplete="off" />
              </div>
              <div className="campo">
                <label htmlFor="apto">Apartamento ou casa</label>
                <input id="apto" name="apto" maxLength={20} required autoComplete="off" />
              </div>
            </div>
            {condo && (
              <div className="aviso info">
                <div><strong>{FORMA_ENTREGA[condo.forma_entrega]}</strong>{condo.janela_entrega ? `, ${condo.janela_entrega}` : ""}.</div>
                <div style={{ whiteSpace: "pre-line" }}>{condo.instrucoes_cliente || "Avisamos pelo WhatsApp quando estivermos chegando."}</div>
              </div>
            )}
          </>
        )}
        {tipo === "entrega" && (
          <>
            <div className="campo">
              <label htmlFor="endereco">Endereço de entrega</label>
              <textarea id="endereco" name="endereco" autoComplete="street-address" required maxLength={300} placeholder="Rua, número, complemento e bairro" />
            </div>
            {c.instrucoes_entrega && <div className="aviso info" style={{ whiteSpace: "pre-line" }}>{c.instrucoes_entrega}</div>}
          </>
        )}
        {tipo === "retirada" && c.retirada_info && (
          <div className="aviso info" style={{ whiteSpace: "pre-line" }}><strong>Retirada:</strong> {c.retirada_info}</div>
        )}
        {c.frete_info && <div className="aviso info"><strong>Entrega:</strong> {c.frete_info}</div>}
        <label className="check" style={{ marginBottom: "1rem", alignItems: "flex-start" }}>
          <input type="checkbox" name="aceita_novidades" style={{ marginTop: "0.3rem" }} />
          <span>Quero receber pelo WhatsApp os avisos de novas rodadas e novidades da The Liscia. <small className="suave">Dá para sair quando quiser.</small></span>
        </label>
        <div className="campo">
          <label htmlFor="observacoes">Observações (opcional)</label>
          <textarea id="observacoes" name="observacoes" maxLength={500} />
        </div>
      </div>

      <div className="cartao">
        <h2>3. Resumo</h2>
        <div className="linha-total"><span>{resumo.bases} {resumo.bases === 1 ? "base" : "bases"}</span><span className="num">{formatarBRL(resumo.itens)}</span></div>
        {tipo !== "retirada" && (
          <div className="linha-total"><span>Entrega{tipo === "condominio" ? " no condomínio" : ""}</span><span className="num">{taxa > 0 ? formatarBRL(taxa) : "grátis"}</span></div>
        )}
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
