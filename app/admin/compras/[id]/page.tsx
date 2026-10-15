import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirAdmin } from "@/lib/auth";
import { FormAcao } from "@/components/FormAcao";
import { formatarBRL } from "@/lib/dinheiro";
import { formatarData, formatarDataHora } from "@/lib/datas";
import { FormCompra } from "../FormCompra";
import { excluirCompra } from "../actions";

export const metadata = { title: "Compra" };

const U: Record<string, string> = { g: "g", kg: "kg", ml: "ml", l: "L", un: "un" };

export default async function Compra({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ salva?: string; editar?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await exigirAdmin();
  const { data: c } = await supabase
    .from("compras")
    .select("*, fornecedores(nome), compra_itens(*, insumos(nome, unidade))")
    .eq("id", id)
    .maybeSingle();
  if (!c) notFound();
  const itens = ((c.compra_itens as any[]) ?? []).sort((a, b) => a.ordem - b.ordem);
  const codigo = `C-${String(c.numero).padStart(4, "0")}`;

  if (sp.editar && !c.cancelada) {
    const [{ data: insumos }, { data: fornecedores }] = await Promise.all([
      supabase.from("insumos").select("id, nome, unidade, insumo_embalagens(id, nome, conteudo, unidade)").order("nome"),
      supabase.from("fornecedores").select("id, nome").order("nome"),
    ]);
    return (
      <>
        <div className="cabecalho"><div><Link href={`/admin/compras/${id}`} className="suave">← {codigo}</Link><h1>Editar compra {codigo}</h1></div></div>
        <FormCompra insumos={(insumos ?? []).map((i: any) => ({ ...i, embalagens: (i.insumo_embalagens ?? []).map((e: any) => ({ ...e, conteudo: Number(e.conteudo) })) }))} fornecedores={fornecedores ?? []} valorHora={c.valor_hora_centavos}
          inicial={{ ...c, itens: itens.map((i) => ({ ...i, pacotes: Number(i.pacotes), conteudo: Number(i.conteudo) })) }} />
      </>
    );
  }

  return (
    <>
      <div className="cabecalho">
        <div>
          <Link href="/admin/compras" className="suave">← Compras</Link>
          <h1>Compra {codigo} {c.cancelada && <span className="selo erro">Excluída</span>}</h1>
        </div>
        {!c.cancelada && <Link className="botao" href={`/admin/compras/${id}?editar=1`}>Editar</Link>}
      </div>
      {sp.salva && <div className="aviso ok">Compra salva e estoque atualizado.</div>}
      {c.cancelada && <div className="aviso erro">Excluída em {formatarDataHora(c.cancelada_em)}{c.cancelada_motivo ? `: ${c.cancelada_motivo}` : ""}. O estoque foi estornado.</div>}

      <div className="cartao">
        <p style={{ margin: 0 }}>
          <strong>{(c.fornecedores as any)?.nome}</strong> · {formatarData(c.data)} · {c.canal === "online" ? "online" : "presencial"}
        </p>
        {c.observacoes && <p className="suave" style={{ margin: "0.4rem 0 0" }}>{c.observacoes}</p>}
      </div>

      <div className="cartao">
        <h2>Itens</h2>
        <div className="tabela-rolagem">
          <table>
            <thead><tr><th>Insumo</th><th>Embalagem</th><th className="dir">Entra no estoque</th><th className="dir">Valor da linha</th><th className="dir">Rateio</th><th className="dir">Custo final</th></tr></thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.id}>
                  <td>{i.insumos?.nome}{i.descricao_original && <div className="suave" style={{ fontSize: "0.8rem" }}>{i.descricao_original}</div>}</td>
                  <td className="num">{Number(i.pacotes).toLocaleString("pt-BR")} × {Number(i.conteudo).toLocaleString("pt-BR")} {U[i.unidade_conteudo]}</td>
                  <td className="dir num">{Number(i.quantidade_base).toLocaleString("pt-BR")} {i.insumos?.unidade}</td>
                  <td className="dir num">{formatarBRL(i.valor_linha_centavos)}</td>
                  <td className="dir num">{formatarBRL(i.rateio_centavos)}</td>
                  <td className="dir num"><strong>{formatarBRL(i.custo_final_centavos)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="linha-total"><span>Soma dos itens</span><span className="num">{formatarBRL(c.subtotal_centavos)}</span></div>
        <div className="linha-total"><span>Frete {formatarBRL(c.frete_centavos)} · serviço {formatarBRL(c.servico_centavos)} · outras {formatarBRL(c.outras_centavos)} · desconto −{formatarBRL(c.desconto_centavos)}</span><span className="num">{formatarBRL(c.total_centavos - c.subtotal_centavos)}</span></div>
        <div className="linha-total forte"><span>Total da compra</span><span className="num">{formatarBRL(c.total_centavos)}</span></div>
        <div className="linha-total suave"><span>Tempo de compra: {c.minutos_trabalho} min a {formatarBRL(c.valor_hora_centavos)}/h (fora do estoque)</span><span className="num">{formatarBRL(c.custo_tempo_centavos)}</span></div>
        {c.ocr_total_centavos != null && <div className="linha-total suave"><span>Total lido no cupom</span><span className="num">{formatarBRL(c.ocr_total_centavos)}</span></div>}
      </div>

      {!c.cancelada && (
        <div className="cartao">
          <h2>Excluir compra</h2>
          <p className="suave">A compra fica no histórico como excluída e a entrada no estoque é estornada.</p>
          <FormAcao acao={excluirCompra} botao="Excluir compra" classeBotao="contorno" confirmar="Excluir esta compra e estornar o estoque?">
            <input type="hidden" name="id" value={c.id} />
            <div className="campo"><label htmlFor="motivo">Motivo</label><input id="motivo" name="motivo" required placeholder="Ex.: lançada em duplicidade" /></div>
          </FormAcao>
        </div>
      )}
    </>
  );
}
