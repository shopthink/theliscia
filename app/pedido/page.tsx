import { carregarCampanhaPublica, carregarContato } from "@/lib/publico";
import { campanhaAberta, formatarData, formatarDataExtenso, hojeSP } from "@/lib/datas";
import { TopoPublico, RodapePublico } from "@/components/Publico";
import { FormPedido } from "./FormPedido";

export const dynamic = "force-dynamic";
export const metadata = { title: "Faça seu pedido" };

export default async function PaginaPedido() {
  const [c, contato] = await Promise.all([carregarCampanhaPublica(), carregarContato()]);
  const aberta = c ? campanhaAberta(c) && c.produtos.length > 0 : false;

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
                  Entrega/retirada: {formatarDataExtenso(c.entrega_em)}
                </div>
                <div style={{ opacity: 0.85, fontSize: "0.92rem" }}>
                  Pedidos até {formatarData(c.fecha_em)} às 23h59 · mínimo de {c.pedido_minimo} bases (pode misturar os tipos)
                </div>
              </div>
            </section>
            <FormPedido campanha={c} />
          </>
        )}
      </main>
      <RodapePublico whatsapp={contato?.whatsapp_contato} instagram={contato?.instagram} />
    </div>
  );
}
