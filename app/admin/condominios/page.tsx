import Link from "next/link";
import { exigirAdmin } from "@/lib/auth";
import { urlDoSite } from "@/lib/env";
import { FORMA_ENTREGA } from "@/lib/condominios";
import { Copiar } from "@/components/Copiar";
import { FormAcao } from "@/components/FormAcao";
import { CamposCondominio } from "./CamposCondominio";
import { criarCondominio } from "./actions";

export const metadata = { title: "Condomínios" };
export const dynamic = "force-dynamic";

export default async function Condominios() {
  const { supabase } = await exigirAdmin();
  const [{ data: lista }, { data: campanha }] = await Promise.all([
    supabase.from("condominios").select("id, nome, slug, forma_entrega, janela_entrega, meta_bases, ativo, clientes(count)").order("ativo", { ascending: false }).order("nome"),
    supabase.from("campanhas").select("id, nome, permite_condominios").eq("ativa", true).maybeSingle(),
  ]);
  const bases = new Map<string, number>();
  if (campanha) {
    await Promise.all((lista ?? []).map(async (c) => {
      const { data } = await supabase.rpc("bases_condominio", { p_condominio_id: c.id, p_campanha_id: campanha.id });
      bases.set(c.id, Number(data ?? 0));
    }));
  }
  const site = urlDoSite();

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Condomínios</h1>
          <p className="suave" style={{ margin: 0 }}>Cada condomínio parceiro tem um link próprio. Quem pede por ele não paga entrega e informa só bloco e apartamento.</p>
        </div>
      </div>
      {campanha && !campanha.permite_condominios && (
        <div className="aviso alerta">A campanha ativa ({campanha.nome}) está com a entrega em condomínios desligada. <Link href={`/admin/campanhas/${campanha.id}`}>Ligar na campanha</Link></div>
      )}
      <div className="cartao">
        {!lista?.length ? (
          <div className="vazio">Nenhum condomínio ainda. Cadastre o primeiro aqui embaixo.</div>
        ) : (
          <div className="tabela-rolagem">
            <table>
              <thead><tr><th>Condomínio</th><th>Entrega</th><th>Clientes</th><th>{campanha ? `Bases em ${campanha.nome}` : "Bases"}</th><th>Link</th></tr></thead>
              <tbody>
                {lista.map((c: any) => {
                  const b = bases.get(c.id) ?? 0;
                  const link = `${site}/pedido?c=${c.slug}`;
                  return (
                    <tr key={c.id}>
                      <td><Link href={`/admin/condominios/${c.id}`}><strong>{c.nome}</strong></Link>{!c.ativo && <> <span className="selo">Inativo</span></>}</td>
                      <td>{FORMA_ENTREGA[c.forma_entrega]}{c.janela_entrega && <div className="suave" style={{ fontSize: "0.82rem" }}>{c.janela_entrega}</div>}</td>
                      <td className="num">{c.clientes?.[0]?.count ?? 0}</td>
                      <td className="num">{campanha ? (c.meta_bases ? `${b} de ${c.meta_bases}` : b) : "—"}</td>
                      <td><Copiar texto={link} rotulo="Copiar link" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="cartao">
        <h2>Novo condomínio</h2>
        <FormAcao acao={criarCondominio} botao="Cadastrar condomínio" classeBotao="bordo">
          <CamposCondominio c={{}} />
        </FormAcao>
      </div>
    </>
  );
}
