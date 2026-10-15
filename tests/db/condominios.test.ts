import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarAmbiente, HOST } from "./ambiente";

describe.skipIf(!HOST)("condomínios e taxa de entrega", () => {
  let amb: Awaited<ReturnType<typeof criarAmbiente>>;
  let campanha: string;
  let prod: string;
  let condo: string;
  let receita: string;
  const AGORA = "2026-10-10T15:00:00Z";

  const adm = <T = any>(sql: string, p: unknown[] = []) => amb.como<T>("admin", sql, p);
  const sol = async (extra: { modalidade?: string; endereco?: string | null; condo?: string | null; bloco?: string | null; apto?: string | null; tel?: string }) =>
    (await amb.como("servico",
      `select * from public.criar_solicitacao($1::jsonb, 'Maria', $2, $3, $4, null, null, $5::timestamptz, $6::uuid, $7, $8)`,
      [JSON.stringify([{ produto_id: prod, quantidade: 3 }]), extra.tel ?? "11 98888-7777", extra.modalidade ?? "entrega",
       extra.endereco ?? null, AGORA, extra.condo ?? null, extra.bloco ?? null, extra.apto ?? null]))[0];

  beforeAll(async () => {
    amb = await criarAmbiente("liscia_condo");
    receita = (await amb.dono.query(`select id from public.receitas where codigo = 'italiana'`)).rows[0].id;
    campanha = (await adm(`insert into public.campanhas (nome, abre_em, fecha_em, entrega_em, pedido_minimo, percentual_sinal,
                             pix_chave, pix_favorecido, taxa_entrega_centavos, permite_retirada)
                           values ('Out', '2026-10-01', '2026-10-20', '2026-10-30', 3, 100, 'chave@x', 'Lucas', 800, false) returning id`))[0].id;
    prod = (await adm(`insert into public.campanha_produtos (campanha_id, receita_id, nome, preco_centavos) values ($1, $2, 'Italiana', 2000) returning id`,
      [campanha, receita]))[0].id;
    await adm(`update public.campanhas set ativa = true where id = $1`, [campanha]);
    condo = (await adm(`insert into public.condominios (nome, slug, endereco, meta_bases) values ('Jardins', 'jardins', 'Rua das Flores, 100', 10) returning id`))[0].id;
  }, 60_000);
  afterAll(async () => amb && (await amb.encerrar()));

  it("anônimo não lê condomínios", async () => {
    await expect(amb.como("anon", `select * from public.condominios`)).rejects.toThrow();
  });

  it("condomínio: grátis, endereço do condomínio, exige apto", async () => {
    await expect(sol({ condo })).rejects.toThrow(/apartamento/);
    const s = await sol({ condo, bloco: "B", apto: "12" });
    const r = (await amb.dono.query(`select modalidade, endereco, condominio_nome, bloco, apto, taxa_entrega_centavos as taxa, total_centavos as total from public.solicitacoes where id = $1`, [s.id])).rows[0];
    expect(r).toEqual({ modalidade: "entrega", endereco: "Rua das Flores, 100", condominio_nome: "Jardins", bloco: "B", apto: "12", taxa: 0, total: 6000 });
    const c = (await amb.dono.query(`select condominio_id, bloco, apto from public.clientes where telefone = '11988887777'`)).rows[0];
    expect(c).toEqual({ condominio_id: condo, bloco: "B", apto: "12" });
  });

  it("entrega avulsa soma a taxa da campanha; retirada desligada é recusada", async () => {
    const s = await sol({ endereco: "Rua Longe, 999, Centro", tel: "11 97777-0000" });
    const r = (await amb.dono.query(`select taxa_entrega_centavos as taxa, total_centavos as total, sinal_centavos as sinal, condominio_id from public.solicitacoes where id = $1`, [s.id])).rows[0];
    expect(r).toEqual({ taxa: 800, total: 6800, sinal: 6800, condominio_id: null });
    await expect(sol({ modalidade: "retirada", tel: "11 97777-0001" })).rejects.toThrow(/receber/);
  });

  it("condomínio inativo ou campanha sem condomínios recusa", async () => {
    await adm(`update public.campanhas set permite_condominios = false where id = $1`, [campanha]);
    await expect(sol({ condo, apto: "1", tel: "11 97777-0002" })).rejects.toThrow(/condomínio/);
    await adm(`update public.campanhas set permite_condominios = true where id = $1`, [campanha]);
    await adm(`update public.condominios set ativo = false where id = $1`, [condo]);
    await expect(sol({ condo, apto: "1", tel: "11 97777-0002" })).rejects.toThrow(/condomínio/);
    await adm(`update public.condominios set ativo = true where id = $1`, [condo]);
  });

  it("aprovação leva condomínio e taxa ao pedido; meta soma bases", async () => {
    const s = (await amb.dono.query(`select id from public.solicitacoes where condominio_id = $1`, [condo])).rows[0];
    expect((await adm(`select public.bases_condominio($1, $2) as b`, [condo, campanha]))[0].b).toBe(0);
    await amb.dono.query(`update public.solicitacoes set status = 'em_conferencia' where id = $1`, [s.id]);
    expect((await adm(`select public.bases_condominio($1, $2) as b`, [condo, campanha]))[0].b).toBe(3);
    const pedido = (await adm(`select public.aprovar_solicitacao($1, 6000) as id`, [s.id]))[0].id;
    const p = (await adm(`select condominio_nome, bloco, apto, taxa_entrega_centavos as taxa from public.pedidos where id = $1`, [pedido]))[0];
    expect(p).toEqual({ condominio_nome: "Jardins", bloco: "B", apto: "12", taxa: 0 });
    expect((await adm(`select public.bases_condominio($1, $2) as b`, [condo, campanha]))[0].b).toBe(3);
  });

  it("pedido manual: condomínio força entrega sem taxa; avulso soma taxa", async () => {
    const itens = JSON.stringify([{ receita_id: receita, quantidade: 2, preco_centavos: 2000 }]);
    const a = (await adm(`select public.criar_pedido_manual('Ana', '11 96666-0001', 'retirada', null, '2026-10-30', null, $1::jsonb, null, null, $2, 'A', '31', 0) as id`, [itens, condo]))[0].id;
    const b = (await adm(`select public.criar_pedido_manual('Bia', '11 96666-0002', 'entrega', 'Rua X, 10, Centro', '2026-10-30', null, $1::jsonb, null, null, null, null, null, 800) as id`, [itens]))[0].id;
    const r = await adm(`select modalidade, condominio_nome, apto, total_centavos as total from public.pedidos where id in ($1, $2) order by numero`, [a, b]);
    expect(r).toEqual([
      { modalidade: "entrega", condominio_nome: "Jardins", apto: "31", total: 4000 },
      { modalidade: "entrega", condominio_nome: null, apto: null, total: 4800 },
    ]);
  });
});
