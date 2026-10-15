import { carregarCampanhaPublica, carregarCondominios, carregarContato } from "@/lib/publico";
import { FORMA_ENTREGA } from "@/lib/condominios";
import { campanhaAberta, formatarData, formatarDataExtenso, hojeSP } from "@/lib/datas";
import { TopoPublico, RodapePublico } from "@/components/Publico";
import { FormPedido } from "./FormPedido";

export const dynamic = "force-dynamic";
export const metadata = { title: "Faça seu pedido" };

export default async function PaginaPedido({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const sp = await searchParams;
  const [c, contato] = await Promise.all([carregarCampanhaPublica(), carregarContato()]);
  const aberta = c ? campanhaAberta(c) && c.produtos.length > 0 : false;
  const condominios = c?.permite_condominios ? await carregarCondominios(c.id) : [];
  const fixo = sp.c ? condominios.find((x) => x.slug === sp.c) ?? null : null;

  return (
    <div className="publico">
      <TopoPublico chamada="Do nosso jeito" />
      <main className="miolo-publico">
        {!c || !aberta ? (
          <div className="cartao" style={{ textAlign: "center", padding: "2rem 1.25rem" }}>
            <h1>Pedidos fechados no momento</h1>
            {c && hojeSP() < c.abre_em ? (
              <p>A próxima rodada abre em <strong>{formatarData(c.abre_em)}</strong>, com entrega em {formatarData(c.entrega_em)}.</p>
            ) : (
              <p>Fique de olho: avisamos quando abrir a próxima rodada.</p>
            )}
            {contato?.whatsapp_contato && (
              <a className="botao" href={`https://wa.me/55${contato.whatsapp_contato.replace(/\D/g, "")}`} target="_blank" rel="noopener">Falar no WhatsApp</a>
            )}
          </div>
        ) : (
          <>
            <section style={{ marginBottom: "1.25rem" }}>
              <h1 style={{ fontSize: "1.7rem" }}>Bases de pizza pré-assadas e congeladas</h1>
              <p>Sem cobertura: você monta do seu jeito e termina no forno de casa.</p>
              <div className="cartao" style={{ background: "var(--verde)", color: "var(--creme)", borderColor: "var(--verde)" }}>
                <div className="caixa-alta" style={{ opacity: 0.8 }}>{c.nome}</div>
                <div style={{ fontSize: "1.15rem", fontWeight: 600, marginTop: "0.2rem" }}>
                  {fixo ? `Entrega no ${fixo.nome}` : c.permite_retirada ? "Entrega/retirada" : "Entrega"}: {formatarDataExtenso(c.entrega_em)}
                </div>
                {fixo && (
                  <div style={{ opacity: 0.85, fontSize: "0.92rem" }}>
                    {FORMA_ENTREGA[fixo.forma_entrega]}{fixo.janela_entrega ? `, ${fixo.janela_entrega}` : ""} · entrega grátis
                  </div>
                )}
                <div style={{ opacity: 0.85, fontSize: "0.92rem" }}>
                  Pedidos até {formatarData(c.fecha_em)} às 23h59 · mínimo de {c.pedido_minimo} bases (pode misturar os tipos)
                </div>
              </div>
            </section>
            {sp.c && !fixo && (
              <div className="aviso alerta">Não encontramos este condomínio entre os atendidos nesta rodada. Você ainda pode pedir com entrega no seu endereço.</div>
            )}
            {fixo?.meta_bases ? <MetaCondominio nome={fixo.nome} bases={fixo.bases} meta={fixo.meta_bases} /> : null}
            <FormPedido campanha={c} condominios={condominios} fixo={fixo} />
          </>
        )}
      </main>
      <RodapePublico whatsapp={contato?.whatsapp_contato} instagram={contato?.instagram} />
    </div>
  );
}

function MetaCondominio({ nome, bases, meta }: { nome: string; bases: number; meta: number }) {
  const pct = Math.min(100, Math.round((bases / meta) * 100));
  const faltam = Math.max(0, meta - bases);
  return (
    <div className="cartao meta-condominio">
      <div className="caixa-alta suave">Meta do {nome}</div>
      <div className="barra-meta" role="progressbar" aria-valuemin={0} aria-valuemax={meta} aria-valuenow={Math.min(bases, meta)}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p style={{ margin: 0 }}>
        {faltam > 0
          ? <><strong>{bases} de {meta} bases</strong> já garantidas. Faltam {faltam} para fechar a entrega no condomínio. Chama os vizinhos!</>
          : <><strong>Meta batida!</strong> {bases} bases garantidas, a entrega no condomínio está confirmada.</>}
      </p>
    </div>
  );
}
