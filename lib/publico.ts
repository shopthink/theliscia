import "server-only";
import { clienteServico } from "@/lib/supabase/servico";

/** Somente os campos que o cliente pode ver. Nada de receita, custo ou margem. */
export interface CampanhaPublica {
  id: string;
  nome: string;
  abre_em: string;
  fecha_em: string;
  entrega_em: string;
  permite_entrega: boolean;
  permite_retirada: boolean;
  permite_condominios: boolean;
  taxa_entrega_centavos: number;
  instrucoes_entrega: string | null;
  regiao_atendida: string | null;
  retirada_info: string | null;
  frete_info: string | null;
  pedido_minimo: number;
  percentual_sinal: number;
  horas_envio_comprovante: number;
  ativa: boolean;
  produtos: { id: string; nome: string; descricao: string | null; preco_centavos: number; foto_url: string | null }[];
}

export async function carregarCampanhaPublica(): Promise<CampanhaPublica | null> {
  const sb = clienteServico();
  const { data } = await sb
    .from("campanhas")
    .select(
      "id, nome, abre_em, fecha_em, entrega_em, permite_entrega, permite_retirada, permite_condominios, taxa_entrega_centavos, instrucoes_entrega, regiao_atendida, retirada_info, frete_info, pedido_minimo, percentual_sinal, horas_envio_comprovante, ativa, campanha_produtos(id, nome, descricao, preco_centavos, foto_url, ordem, ativo)",
    )
    .eq("ativa", true)
    .maybeSingle();
  if (!data) return null;
  const { campanha_produtos, ...resto } = data as any;
  return {
    ...resto,
    produtos: (campanha_produtos ?? [])
      .filter((p: any) => p.ativo && p.preco_centavos > 0)
      .sort((a: any, b: any) => a.ordem - b.ordem)
      .map(({ id, nome, descricao, preco_centavos, foto_url }: any) => ({ id, nome, descricao, preco_centavos, foto_url })),
  };
}

/** Condomínio parceiro como o morador vê: sem notas internas. */
export interface CondominioPublico {
  id: string;
  nome: string;
  slug: string;
  forma_entrega: string;
  janela_entrega: string | null;
  instrucoes_cliente: string | null;
  meta_bases: number | null;
  bases: number;
}

export async function carregarCondominios(campanhaId: string | null): Promise<CondominioPublico[]> {
  const sb = clienteServico();
  const { data } = await sb
    .from("condominios")
    .select("id, nome, slug, forma_entrega, janela_entrega, instrucoes_cliente, meta_bases")
    .eq("ativo", true)
    .order("nome");
  return Promise.all(
    (data ?? []).map(async (c) => {
      let bases = 0;
      if (campanhaId && c.meta_bases) {
        const { data: b } = await sb.rpc("bases_condominio", { p_condominio_id: c.id, p_campanha_id: campanhaId });
        bases = Number(b ?? 0);
      }
      return { ...c, bases };
    }),
  );
}

export async function carregarContato() {
  const sb = clienteServico();
  const { data } = await sb.from("configuracoes").select("nome_comercial, whatsapp_contato, instagram").maybeSingle();
  return data;
}

export const TOKEN_VALIDO = /^[0-9a-f]{64}$/;
