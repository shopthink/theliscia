import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirAdmin } from "@/lib/auth";
import { FormAcao } from "@/components/FormAcao";
import { Copiar } from "@/components/Copiar";
import { campanhaAberta, formatarData, hojeSP } from "@/lib/datas";
import { formatarBRL } from "@/lib/dinheiro";
import { urlDoSite } from "@/lib/env";
import { CamposCampanha } from "../CamposCampanha";
import { alternarVendas, removerProduto, salvarCampanha, salvarProduto } from "../actions";

export const metadata = { title: "Campanha" };

export default async function EditarCampanha({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ criada?: string }> }) {
  const { id } = await params;
  const { criada } = await searchParams;
  const { supabase } = await exigirAdmin();
  const [{ data: c }, { data: produtos }, { data: receitas }, { data: motivo }] = await Promise.all([
    supabase.from("campanhas").select("*").eq("id", id).maybeSingle(),
    supabase.from("campanha_produtos").select("*").eq("campanha_id", id).order("ordem").order("criado_em"),
    supabase.from("receitas").select("id, nome").eq("ativa", true).order("nome"),
    supabase.rpc("campanha_pode_vender", { p_campanha_id: id }),
  ]);
  if (!c) notFound();

  const link = `${urlDoSite()}/pedido`;
  const aberta = campanhaAberta(c);
  const hoje = hojeSP();

  return (
    <>
      <div className="cabecalho">
        <div>
          <Link href="/admin/campanhas" className="suave">← Campanhas</Link>
          <h1>{c.nome}</h1>
        </div>
      </div>
      {criada && <div className="aviso ok">Campanha criada e pausada. Confira os produtos e o Pix e ative as vendas.</div>}

      <div className="cartao">
        <div className="acoes" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="caixa-alta suave">Vendas</div>
            {c.ativa ? (
              aberta ? <strong style={{ color: "var(--ok)" }}>Ativas: o link aceita pedidos agora</strong>
              : <strong style={{ color: "var(--alerta)" }}>Ativas, mas fora da janela ({hoje < c.abre_em ? `abre em ${formatarData(c.abre_em)}` : "janela encerrada"})</strong>
            ) : (
              <strong>Pausadas</strong>
            )}
            <p className="suave" style={{ margin: "0.25rem 0 0" }}>
              Pedidos de {formatarData(c.abre_em)} a {formatarData(c.fecha_em)} (até 23h59) · entrega em {formatarData(c.entrega_em)}
            </p>
          </div>
          <FormAcao acao={alternarVendas} botao={c.ativa ? "Pausar vendas" : "Ativar vendas"} classeBotao={c.ativa ? "contorno" : "bordo"}
            confirmar={c.ativa ? "Pausar as vendas? O link público vai mostrar pedidos fechados." : undefined}>
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="versao" value={c.versao} />
            <input type="hidden" name="ativar" value={c.ativa ? "0" : "1"} />
          </FormAcao>
        </div>
        {!c.ativa && motivo && <div className="aviso alerta" style={{ marginTop: "0.75rem", marginBottom: 0 }}>Para ativar: {motivo}</div>}
        <hr />
        <div className="caixa-alta suave">Link público de pedidos</div>
        <div className="acoes" style={{ marginTop: "0.35rem" }}>
          <code className="pix-chave" style={{ flex: "1 1 260px" }}>{link}</code>
          <Copiar texto={link} rotulo="Copiar link" />
          <a className="botao contorno pequeno" href="/pedido" target="_blank" rel="noopener">Abrir</a>
        </div>
        <p className="suave" style={{ marginTop: "0.5rem", marginBottom: 0 }}>O link mostra sempre a campanha ativa. Só uma campanha pode estar ativa por vez.</p>
      </div>

      <div className="cartao">
        <h2>Produtos e preços</h2>
        <p className="suave">O cliente vê nome, descrição, preço e foto. Ficha técnica, custos e margem nunca aparecem.</p>
        {!receitas?.length && <div className="aviso alerta">Cadastre receitas antes de criar produtos.</div>}
        {(produtos ?? []).map((p: any) => (
          <div key={p.id} style={{ borderTop: "1px solid var(--creme-2)", paddingTop: "1rem", marginTop: "1rem" }}>
            <FormAcao acao={salvarProduto} botao="Salvar produto" classeBotao="pequeno">
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="campanha_id" value={c.id} />
              <CamposProduto p={p} receitas={receitas ?? []} />
            </FormAcao>
            <div style={{ marginTop: "0.5rem" }}>
              <FormAcao acao={removerProduto} botao="Remover" classeBotao="contorno pequeno" confirmar={`Remover ${p.nome}?`}>
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="campanha_id" value={c.id} />
              </FormAcao>
            </div>
          </div>
        ))}
        <div style={{ borderTop: "1.5px solid var(--linha)", paddingTop: "1rem", marginTop: "1rem" }}>
          <h3>Adicionar produto</h3>
          <FormAcao acao={salvarProduto} botao="Adicionar" limparAoSalvar>
            <input type="hidden" name="campanha_id" value={c.id} />
            <CamposProduto p={{ ativo: true, ordem: (produtos?.length ?? 0) + 1 }} receitas={receitas ?? []} />
          </FormAcao>
        </div>
      </div>

      <div className="cartao">
        <FormAcao acao={salvarCampanha} botao="Salvar campanha">
          <input type="hidden" name="id" value={c.id} />
          <input type="hidden" name="versao" value={c.versao} />
          <CamposCampanha c={c} />
        </FormAcao>
      </div>
    </>
  );
}

function CamposProduto({ p, receitas }: { p: any; receitas: { id: string; nome: string }[] }) {
  const sufixo = p.id ?? "novo";
  return (
    <>
      <div className="grade">
        <div className="campo">
          <label htmlFor={`nome-${sufixo}`}>Nome comercial</label>
          <input id={`nome-${sufixo}`} name="nome" defaultValue={p.nome ?? ""} placeholder="Base Italiana clássica" required maxLength={80} />
        </div>
        <div className="campo">
          <label htmlFor={`receita-${sufixo}`}>Receita interna</label>
          <select id={`receita-${sufixo}`} name="receita_id" defaultValue={p.receita_id ?? ""} required>
            <option value="" disabled>Escolha…</option>
            {receitas.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor={`preco-${sufixo}`}>Preço por base (R$)</label>
          <input id={`preco-${sufixo}`} name="preco" inputMode="decimal" defaultValue={p.preco_centavos ? (p.preco_centavos / 100).toFixed(2).replace(".", ",") : ""} placeholder="0,00" required />
          {p.preco_centavos ? <span className="ajuda">Atual: {formatarBRL(p.preco_centavos)}</span> : null}
        </div>
      </div>
      <div className="campo">
        <label htmlFor={`desc-${sufixo}`}>Descrição</label>
        <textarea id={`desc-${sufixo}`} name="descricao" defaultValue={p.descricao ?? ""} maxLength={400} placeholder="Base pré-assada e congelada, sem cobertura. Borda alta." />
      </div>
      <div className="grade">
        <div className="campo">
          <label htmlFor={`foto-${sufixo}`}>Foto (endereço https, opcional)</label>
          <input id={`foto-${sufixo}`} name="foto_url" type="text" defaultValue={p.foto_url ?? ""} placeholder="Só use foto real do produto" />
        </div>
        <div className="campo">
          <label htmlFor={`ordem-${sufixo}`}>Ordem</label>
          <input id={`ordem-${sufixo}`} name="ordem" type="number" defaultValue={p.ordem ?? 0} />
        </div>
        <div className="campo" style={{ alignSelf: "center" }}>
          <label className="check"><input type="checkbox" name="ativo" defaultChecked={p.ativo ?? true} /> Disponível</label>
        </div>
      </div>
    </>
  );
}
