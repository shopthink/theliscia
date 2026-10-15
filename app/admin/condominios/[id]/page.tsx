import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirAdmin } from "@/lib/auth";
import { urlDoSite } from "@/lib/env";
import { formatarBRL } from "@/lib/dinheiro";
import { formatarData } from "@/lib/datas";
import { compararUnidade, unidade } from "@/lib/condominios";
import { formatarTelefone } from "@/lib/telefone";
import { Copiar } from "@/components/Copiar";
import { FormAcao } from "@/components/FormAcao";
import { SeloProducao } from "@/components/Selos";
import { CamposCondominio } from "../CamposCondominio";
import { salvarCondominio } from "../actions";

export const metadata = { title: "Condomínio" };
export const dynamic = "force-dynamic";

export default async function Condominio({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ criado?: string }> }) {
  const { id } = await params;
  const { criado } = await searchParams;
  const { supabase } = await exigirAdmin();
  const [{ data: c }, { data: campanha }, { data: cfg }] = await Promise.all([
    supabase.from("condominios").select("*").eq("id", id).maybeSingle(),
    supabase.from("campanhas").select("id, nome, fecha_em, entrega_em").eq("ativa", true).maybeSingle(),
    supabase.from("configuracoes").select("nome_comercial").maybeSingle(),
  ]);
  if (!c) notFound();
  const [{ data: clientes }, { data: pedidos }, { data: bases }] = await Promise.all([
    supabase.from("clientes").select("id, nome, telefone, bloco, apto").eq("condominio_id", id).order("nome"),
    campanha
      ? supabase.from("pedidos").select("id, numero, cliente_nome, bloco, apto, total_centavos, status_producao, pedido_itens(quantidade)").eq("condominio_id", id).eq("campanha_id", campanha.id).neq("status_producao", "cancelado")
      : Promise.resolve({ data: [] as any[] }),
    campanha ? supabase.rpc("bases_condominio", { p_condominio_id: id, p_campanha_id: campanha.id }) : Promise.resolve({ data: 0 }),
  ]);
  const link = `${urlDoSite()}/pedido?c=${c.slug}`;
  const convite = campanha
    ? `Oi, vizinhos! Aqui é da ${cfg?.nome_comercial ?? "The Liscia Pizzas"}. Fazemos bases de pizza pré-assadas e congeladas: você coloca a cobertura e leva ao forno. ` +
      `Nesta rodada vamos entregar aqui no ${c.nome}, sem taxa, no dia ${formatarData(campanha.entrega_em)}. ` +
      `Pedidos até ${formatarData(campanha.fecha_em)} pelo link: ${link}`
    : null;

  return (
    <>
      <div className="cabecalho">
        <div>
          <Link href="/admin/condominios" className="suave">← Condomínios</Link>
          <h1>{c.nome} {!c.ativo && <span className="selo">Inativo</span>}</h1>
        </div>
      </div>
      {criado && <div className="aviso ok">Condomínio cadastrado. Copie o link e solte no grupo do condomínio.</div>}

      <div className="cartao">
        <h2>Divulgação</h2>
        <div className="acoes">
          <code className="pix-chave" style={{ flex: "1 1 240px" }}>{link}</code>
          <Copiar texto={link} rotulo="Copiar link" />
          <a className="botao contorno pequeno" href={`/pedido?c=${c.slug}`} target="_blank" rel="noopener">Abrir</a>
        </div>
        {convite && (
          <>
            <p className="suave" style={{ marginBottom: "0.4rem" }}>Mensagem pronta para o grupo do condomínio:</p>
            <div className="pix-chave" style={{ fontFamily: "inherit", whiteSpace: "pre-line" }}>{convite}</div>
            <div style={{ marginTop: "0.5rem" }}><Copiar texto={convite} rotulo="Copiar mensagem" /></div>
          </>
        )}
      </div>

      {campanha && (
        <div className="cartao">
          <h2>{campanha.nome}</h2>
          <p style={{ marginTop: 0 }}>
            <strong>{Number(bases ?? 0)} bases</strong> garantidas{c.meta_bases ? ` de ${c.meta_bases} da meta` : ""} · entrega em {formatarData(campanha.entrega_em)}
          </p>
          {!pedidos?.length ? <div className="vazio">Nenhum pedido confirmado deste condomínio ainda.</div> : (
            <div className="tabela-rolagem">
              <table>
                <thead><tr><th>Unidade</th><th>Pedido</th><th>Cliente</th><th>Bases</th><th className="dir">Total</th><th>Produção</th></tr></thead>
                <tbody>
                  {[...pedidos].sort(compararUnidade).map((p: any) => (
                    <tr key={p.id}>
                      <td>{unidade(p.bloco, p.apto)}</td>
                      <td><Link href={`/admin/pedidos/${p.id}`}>#{String(p.numero).padStart(4, "0")}</Link></td>
                      <td>{p.cliente_nome}</td>
                      <td className="num">{p.pedido_itens.reduce((s: number, i: any) => s + i.quantidade, 0)}</td>
                      <td className="dir num">{formatarBRL(p.total_centavos)}</td>
                      <td><SeloProducao valor={p.status_producao} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="cartao">
        <h2>Dados do condomínio</h2>
        <FormAcao acao={salvarCondominio} botao="Salvar">
          <input type="hidden" name="id" value={c.id} />
          <input type="hidden" name="versao" value={c.versao} />
          <CamposCondominio c={c} edicao />
        </FormAcao>
      </div>

      <div className="cartao">
        <h2>Moradores que já pediram ({clientes?.length ?? 0})</h2>
        {!clientes?.length ? <div className="vazio">Ninguém ainda.</div> : clientes.sort(compararUnidade).map((k) => (
          <div key={k.id} className="linha-total">
            <span>{k.nome} <span className="suave">· {unidade(k.bloco, k.apto)}</span></span>
            <span className="suave num">{formatarTelefone(k.telefone)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
