import { exigirAdmin } from "@/lib/auth";
import { FormAcao } from "@/components/FormAcao";
import { salvarConfiguracoes } from "./actions";

export const metadata = { title: "Configurações" };

export default async function Configuracoes() {
  const { supabase } = await exigirAdmin();
  const { data: c } = await supabase.from("configuracoes").select("*").single();
  if (!c) return null;
  const n = (v: number) => String(v).replace(".", ",");
  return (
    <>
      <div className="cabecalho"><h1>Configurações</h1></div>
      <div className="cartao">
        <FormAcao acao={salvarConfiguracoes} botao="Salvar configurações">
          <input type="hidden" name="versao" value={c.versao} />
          <h2>Contato</h2>
          <p className="suave">WhatsApp e Instagram aparecem no rodapé da página de pedidos.</p>
          <div className="grade">
            <div className="campo"><label htmlFor="nome_comercial">Nome comercial</label><input id="nome_comercial" name="nome_comercial" defaultValue={c.nome_comercial} /></div>
            <div className="campo"><label htmlFor="whatsapp_contato">WhatsApp</label><input id="whatsapp_contato" name="whatsapp_contato" type="tel" defaultValue={c.whatsapp_contato ?? ""} /></div>
            <div className="campo"><label htmlFor="instagram">Instagram</label><input id="instagram" name="instagram" defaultValue={c.instagram ?? ""} placeholder="@theliscia" /></div>
            <div className="campo"><label htmlFor="email_contato">E-mail</label><input id="email_contato" name="email_contato" type="email" defaultValue={c.email_contato ?? ""} /></div>
          </div>
          <h2>Custos</h2>
          <div className="grade">
            <div className="campo">
              <label htmlFor="valor_hora">Valor da hora trabalhada (R$)</label>
              <input id="valor_hora" name="valor_hora" inputMode="decimal" defaultValue={(c.valor_hora_centavos / 100).toFixed(2).replace(".", ",")} />
              <span className="ajuda">Copiado para cada compra e lote no momento do registro.</span>
            </div>
            <div className="campo">
              <label htmlFor="taxa_percentual">Taxas/tributos provisionados (%)</label>
              <input id="taxa_percentual" name="taxa_percentual" inputMode="decimal" defaultValue={n(c.taxa_percentual)} />
            </div>
          </div>
          <h2>Consumos auxiliares</h2>
          <p className="suave">Estimativas usadas no planejamento da produção até você medir os valores reais.</p>
          <div className="grade">
            <div className="campo"><label htmlFor="semola_g_por_base">Sêmola por base (g)</label><input id="semola_g_por_base" name="semola_g_por_base" inputMode="decimal" defaultValue={n(c.semola_g_por_base)} /><span className="ajuda">7 g é estimativa não medida.</span></div>
            <div className="campo"><label htmlFor="saco_vacuo_por_base">Sacos a vácuo por base</label><input id="saco_vacuo_por_base" name="saco_vacuo_por_base" inputMode="decimal" defaultValue={n(c.saco_vacuo_por_base)} /></div>
            <div className="campo"><label htmlFor="etiqueta_por_base">Etiquetas por base</label><input id="etiqueta_por_base" name="etiqueta_por_base" inputMode="decimal" defaultValue={n(c.etiqueta_por_base)} /></div>
            <div className="campo"><label htmlFor="molho_g_por_base">Molho de marcação por base (g)</label><input id="molho_g_por_base" name="molho_g_por_base" inputMode="decimal" defaultValue={n(c.molho_g_por_base)} /><span className="ajuda">0 = sem molho.</span></div>
            <div className="campo"><label htmlFor="sacola_por_pedido">Sacolas kraft por pedido</label><input id="sacola_por_pedido" name="sacola_por_pedido" inputMode="decimal" defaultValue={n(c.sacola_por_pedido)} /></div>
          </div>
          <h2>Fabricante (rodapé da etiqueta)</h2>
          <p className="suave">Quem produz e responde pelo produto. Confirme as exigências para o seu enquadramento (MEI, alvará, vigilância sanitária).</p>
          <div className="grade">
            <div className="campo"><label htmlFor="rotulo_fabricante">Nome ou razão social</label><input id="rotulo_fabricante" name="rotulo_fabricante" defaultValue={c.rotulo_fabricante ?? ""} /></div>
            <div className="campo"><label htmlFor="rotulo_documento">CNPJ ou CPF</label><input id="rotulo_documento" name="rotulo_documento" defaultValue={c.rotulo_documento ?? ""} /></div>
            <div className="campo"><label htmlFor="rotulo_endereco">Endereço</label><input id="rotulo_endereco" name="rotulo_endereco" defaultValue={c.rotulo_endereco ?? ""} /></div>
            <div className="campo"><label htmlFor="rotulo_contato">Contato (SAC)</label><input id="rotulo_contato" name="rotulo_contato" defaultValue={c.rotulo_contato ?? ""} placeholder="WhatsApp ou e-mail" /></div>
          </div>
          <h2>Tempos de referência da produção</h2>
          <p className="suave">Usados nas contagens regressivas das esperas. Não contam como trabalho.</p>
          <div className="grade">
            <div className="campo"><label htmlFor="descanso_min">Descanso da massa (min)</label><input id="descanso_min" name="descanso_min" inputMode="numeric" defaultValue={c.descanso_min} /></div>
            <div className="campo"><label htmlFor="dobra_min">Aviso de dobra após (min)</label><input id="dobra_min" name="dobra_min" inputMode="numeric" defaultValue={c.dobra_min} /><span className="ajuda">0 = sem aviso.</span></div>
            <div className="campo"><label htmlFor="geladeira_h">Geladeira (horas)</label><input id="geladeira_h" name="geladeira_h" inputMode="decimal" defaultValue={n(c.geladeira_min / 60)} /></div>
            <div className="campo"><label htmlFor="esfriar_min">Esfriar depois de assar (min)</label><input id="esfriar_min" name="esfriar_min" inputMode="numeric" defaultValue={c.esfriar_min} /></div>
            <div className="campo"><label htmlFor="freezer_h">Freezer para firmar (horas)</label><input id="freezer_h" name="freezer_h" inputMode="decimal" defaultValue={n(c.freezer_min / 60)} /></div>
          </div>
        </FormAcao>
      </div>
    </>
  );
}
