import Link from "next/link";
import { exigirAdmin } from "@/lib/auth";
import { FormAcao } from "@/components/FormAcao";
import { CamposCampanha } from "../CamposCampanha";
import { criarCampanha } from "../actions";

export const metadata = { title: "Nova campanha" };

export default async function NovaCampanha() {
  const { supabase } = await exigirAdmin();
  const { data: anterior } = await supabase
    .from("campanhas")
    .select("id, nome, permite_entrega, permite_retirada, permite_condominios, taxa_entrega_centavos, instrucoes_entrega, regiao_atendida, retirada_info, frete_info, pedido_minimo, pix_chave, pix_favorecido, pix_cidade, percentual_sinal, horas_envio_comprovante")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <>
      <div className="cabecalho">
        <div>
          <Link href="/admin/campanhas" className="suave">← Campanhas</Link>
          <h1>Nova campanha</h1>
        </div>
      </div>
      {anterior && (
        <div className="aviso info">
          Os campos de entrega e Pix vieram de <strong>{anterior.nome}</strong>. Confira antes de salvar.
        </div>
      )}
      <div className="cartao">
        <FormAcao acao={criarCampanha} botao="Criar campanha (pausada)">
          <CamposCampanha c={{ ...(anterior ?? {}), nome: "" }} />
          {anterior && (
            <label className="check" style={{ marginBottom: "1rem" }}>
              <input type="checkbox" name="copiar_de" value={anterior.id} defaultChecked /> Copiar os produtos e preços de {anterior.nome}
            </label>
          )}
          <p className="suave">A campanha nasce pausada. Depois de conferir produtos e Pix, ative as vendas.</p>
        </FormAcao>
      </div>
    </>
  );
}
