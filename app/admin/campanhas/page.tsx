import Link from "next/link";
import { exigirAdmin } from "@/lib/auth";
import { campanhaAberta, formatarData } from "@/lib/datas";

export const metadata = { title: "Campanhas" };

export default async function Campanhas() {
  const { supabase } = await exigirAdmin();
  const { data: campanhas } = await supabase
    .from("campanhas")
    .select("id, nome, ativa, abre_em, fecha_em, entrega_em, campanha_produtos(count), solicitacoes(count)")
    .order("abre_em", { ascending: false });

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Campanhas</h1>
          <p className="suave" style={{ margin: 0 }}>Cada campanha define janela de pedidos, entrega, produtos, preços e Pix.</p>
        </div>
        <Link className="botao bordo" href="/admin/campanhas/nova">Nova campanha</Link>
      </div>
      <div className="cartao">
        {!campanhas?.length ? (
          <div className="vazio">
            <p>Nenhuma campanha ainda.</p>
            <Link className="botao" href="/admin/campanhas/nova">Criar a primeira</Link>
          </div>
        ) : (
          <div className="tabela-rolagem">
            <table>
              <thead>
                <tr><th>Campanha</th><th>Pedidos de</th><th>até</th><th>Entrega</th><th>Produtos</th><th>Solicitações</th><th>Situação</th></tr>
              </thead>
              <tbody>
                {campanhas.map((c: any) => {
                  const aberta = campanhaAberta(c);
                  return (
                    <tr key={c.id}>
                      <td><Link href={`/admin/campanhas/${c.id}`}><strong>{c.nome}</strong></Link></td>
                      <td className="num">{formatarData(c.abre_em)}</td>
                      <td className="num">{formatarData(c.fecha_em)}</td>
                      <td className="num">{formatarData(c.entrega_em)}</td>
                      <td className="num">{c.campanha_produtos?.[0]?.count ?? 0}</td>
                      <td className="num">{c.solicitacoes?.[0]?.count ?? 0}</td>
                      <td>
                        {c.ativa ? (
                          aberta ? <span className="selo ok">Vendendo agora</span> : <span className="selo alerta">Ativa, fora da janela</span>
                        ) : (
                          <span className="selo">Pausada</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
