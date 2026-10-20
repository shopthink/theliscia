import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarAmbiente, HOST } from "./ambiente";

describe.skipIf(!HOST)("insumos da casa, perdas e brinde", () => {
  let amb: Awaited<ReturnType<typeof criarAmbiente>>;
  const ins: Record<string, string> = {};
  const rec: Record<string, string> = {};
  const q = <T = any>(sql: string, p: unknown[] = []) => amb.como<T>("admin", sql, p);
  const um = async <T = any>(sql: string, p: unknown[] = []) => (await q<T>(sql, p))[0];

  beforeAll(async () => {
    amb = await criarAmbiente("liscia_casa");
    await amb.dono.query(`update public.configuracoes set valor_hora_centavos = 0, semola_g_por_base = 0, molho_g_por_base = 0, saco_vacuo_por_base = 0, etiqueta_por_base = 0, sacola_por_pedido = 0`);
    for (const r of (await amb.dono.query(`select id, nome from public.insumos`)).rows) ins[r.nome] = r.id;
    for (const r of (await amb.dono.query(`select id, codigo from public.receitas`)).rows) rec[r.codigo] = r.id;
    // Sal e fermento são da casa, com custo padrão
    await q(`update public.insumos set controla_estoque = false, preco_ref_centavos = 0.4 where id = $1`, [ins.Sal]);
    await q(`update public.insumos set controla_estoque = false, preco_ref_centavos = 6 where id = $1`, [ins["Fermento biológico fresco"]]);
    await q(`update public.insumos set controla_estoque = false where id in ($1, $2)`, [ins["Água filtrada"], ins.Cerveja]);
  }, 60_000);
  afterAll(async () => amb && (await amb.encerrar()));

  it("compra de insumo da casa não entra no estoque e atualiza o custo padrão (com histórico)", async () => {
    await q(`select public.salvar_compra($1::jsonb)`, [JSON.stringify({
      fornecedor_nome: "Mercado", data: "2026-10-10", canal: "presencial", minutos_trabalho: 0,
      itens: [
        { insumo_id: ins.Sal, pacotes: 1, conteudo: 1, unidade_conteudo: "kg", valor_linha_centavos: 500 },
        { insumo_id: ins.Farinha, pacotes: 2, conteudo: 1, unidade_conteudo: "kg", valor_linha_centavos: 1000 },
      ],
    })]);
    expect(await q(`select * from public.estoque_saldos where insumo_id = $1`, [ins.Sal])).toHaveLength(0);
    expect(Number((await um(`select preco_ref_centavos from public.insumos where id = $1`, [ins.Sal])).preco_ref_centavos)).toBeCloseTo(0.5);
    const h = await q(`select custo_centavos::float as c from public.insumo_custos_padrao where insumo_id = $1 order by desde`, [ins.Sal]);
    expect(h.map((x) => x.c)).toEqual([0.4, 0.5]);
  });

  it("perda e ajuste só em insumo controlado; perda guarda o motivo", async () => {
    await expect(q(`select public.registrar_ajuste_estoque($1, -10, 'perda', 'x', null, null, 'derramou')`, [ins.Sal])).rejects.toThrow(/insumo da casa/);
    await q(`select public.registrar_ajuste_estoque($1, -200, 'perda', null, '2026-10-11', null, 'uso_indevido')`, [ins.Farinha]);
    await expect(q(`select public.registrar_ajuste_estoque($1, 50, 'ajuste', '', '2026-10-11', null, null)`, [ins.Farinha])).rejects.toThrow(/Descreva/);
    await q(`select public.registrar_ajuste_estoque($1, 50, 'ajuste', 'contagem', '2026-10-11', null, null)`, [ins.Farinha]);
    const m = await q(`select tipo, categoria, valor_centavos::float as v from public.estoque_movimentos where insumo_id = $1 and tipo in ('perda','ajuste') order by criado_em`, [ins.Farinha]);
    expect(m).toEqual([{ tipo: "perda", categoria: "uso_indevido", v: -100 }, { tipo: "ajuste", categoria: "inventario", v: 25 }]);
  });

  it("pedido brinde: valor zero, sem pagamento, status cortesia", async () => {
    const id = (await um(`select public.criar_pedido_manual('Vizinho', '11 98888-0009', 'retirada', null, '2026-10-30', null, $1::jsonb,
                            null, '{"valor_centavos": 1000, "metodo": "pix"}'::jsonb, null, null, null, 0, 'brinde') as id`,
      [JSON.stringify([{ receita_id: rec.italiana, quantidade: 2, preco_centavos: 2500 }])])).id;
    const p = await um(`select tipo, total_centavos, status_pagamento, recebido_centavos from public.pedidos where id = $1`, [id]);
    expect(p).toEqual({ tipo: "brinde", total_centavos: 0, status_pagamento: "cortesia", recebido_centavos: 0 });
    expect((await um(`select sum(subtotal_centavos)::int as s from public.pedido_itens where pedido_id = $1`, [id])).s).toBe(0);
    await expect(q(`insert into public.pagamentos (pedido_id, valor_centavos, metodo) values ($1, 100, 'pix')`, [id])).rejects.toThrow(/brinde/);
  });

  it("lote: insumo da casa entra no custo pelo custo padrão, sem baixa; controlado baixa estoque", async () => {
    const item = (await um(`select i.id from public.pedido_itens i join public.pedidos p on p.id = i.pedido_id where p.tipo = 'brinde'`)).id;
    const lote = (await um(`select public.criar_lote($1::jsonb) as id`, [JSON.stringify({ receita_id: rec.italiana, item_ids: [item] })])).id;
    await q(`select public.salvar_apontamento_lote($1::jsonb)`, [JSON.stringify({ id: lote, unidades_boas: 2, perdas: 0 })]);
    await q(`select public.registrar_sessao($1, 'massa', '2026-10-14T10:00:00Z', '2026-10-14T10:30:00Z', null)`, [lote]);
    const farinhaAntes = Number((await um(`select sum(quantidade) as q from public.estoque_saldos where insumo_id = $1`, [ins.Farinha])).q);
    await q(`select public.concluir_lote($1)`, [lote]);
    const sal = await um(`select quantidade_real::float as q, custo_unitario_centavos::float as cu, custo_total_centavos::float as ct from public.lote_consumos where lote_id = $1 and insumo_id = $2`, [lote, ins.Sal]);
    expect(sal.cu).toBeCloseTo(0.5);
    expect(sal.ct).toBeCloseTo(sal.q * 0.5, 3);
    expect(await q(`select * from public.estoque_movimentos where lote_id = $1 and insumo_id = $2`, [lote, ins.Sal])).toHaveLength(0);
    const farinhaDepois = Number((await um(`select sum(quantidade) as q from public.estoque_saldos where insumo_id = $1`, [ins.Farinha])).q);
    expect(farinhaAntes - farinhaDepois).toBeGreaterThan(0);
    expect(Number((await um(`select custo_materiais_centavos from public.lotes where id = $1`, [lote])).custo_materiais_centavos)).toBeGreaterThan(0);
  });
});
