import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarAmbiente, HOST } from "./ambiente";

describe.skipIf(!HOST)("marcas e estoque por marca", () => {
  let amb: Awaited<ReturnType<typeof criarAmbiente>>;
  const ins: Record<string, string> = {};
  const rec: Record<string, string> = {};
  let caputo: string;
  let lote: string;
  const q = <T = any>(sql: string, p: unknown[] = []) => amb.como<T>("admin", sql, p);
  const um = async <T = any>(sql: string, p: unknown[] = []) => (await q<T>(sql, p))[0];
  const saldo = async (marca: string | null) => um(`select quantidade::float as q, valor_centavos::float as v from public.estoque_saldos
      where insumo_id = $1 and marca_id is not distinct from $2`, [ins.Farinha, marca]);
  const compra = (itens: unknown[], data = "2026-10-10") =>
    um(`select public.salvar_compra($1::jsonb) as id`, [JSON.stringify({ fornecedor_nome: "Atacadão", data, canal: "presencial", minutos_trabalho: 0, itens })]);

  beforeAll(async () => {
    amb = await criarAmbiente("liscia_marcas");
    await amb.dono.query(`update public.configuracoes set valor_hora_centavos = 0, semola_g_por_base = 0, molho_g_por_base = 0, saco_vacuo_por_base = 0, etiqueta_por_base = 0, sacola_por_pedido = 0`);
    for (const r of (await amb.dono.query(`select id, nome from public.insumos`)).rows) ins[r.nome] = r.id;
    for (const r of (await amb.dono.query(`select id, codigo from public.receitas`)).rows) rec[r.codigo] = r.id;
  }, 60_000);
  afterAll(async () => amb && (await amb.encerrar()));

  it("compra cria marca pelo nome, marca em uso e separa estoque e custo", async () => {
    await compra([
      { insumo_id: ins.Farinha, marca_nome: "Caputo Pizzeria", usar_marca: true, pacotes: 2, conteudo: 1, unidade_conteudo: "kg", valor_linha_centavos: 3000 },
      { insumo_id: ins.Farinha, marca_nome: "Embramex", pacotes: 1, conteudo: 5, unidade_conteudo: "kg", valor_linha_centavos: 2500 },
      { insumo_id: ins.Farinha, pacotes: 1, conteudo: 1, unidade_conteudo: "kg", valor_linha_centavos: 400 },
    ]);
    caputo = (await um(`select id from public.marcas where nome = 'Caputo Pizzeria'`)).id;
    const emb = (await um(`select id from public.marcas where nome = 'Embramex'`)).id;
    expect(await saldo(caputo)).toEqual({ q: 2000, v: 3000 });
    expect(await saldo(emb)).toEqual({ q: 5000, v: 2500 });
    expect(await saldo(null)).toEqual({ q: 1000, v: 400 });
    expect((await um(`select em_uso from public.marcas where id = $1`, [caputo])).em_uso).toBe(true);
    expect(Number((await um(`select public.custo_unitario_marca($1, $2) as c`, [ins.Farinha, caputo])).c)).toBeCloseTo(1.5);
    expect(Number((await um(`select public.custo_unitario_atual($1) as c`, [ins.Farinha])).c)).toBeCloseTo(5900 / 8000);
    // Mesmo nome de novo (outra caixa): reaproveita a marca
    await compra([{ insumo_id: ins.Farinha, marca_nome: " caputo pizzeria ", pacotes: 1, conteudo: 1, unidade_conteudo: "kg", valor_linha_centavos: 1700 }], "2026-10-11");
    expect((await um(`select count(*)::int as n from public.marcas where insumo_id = $1`, [ins.Farinha])).n).toBe(2);
    expect(await saldo(caputo)).toEqual({ q: 3000, v: 4700 });
  });

  it("marca de outro insumo é recusada; em uso é única", async () => {
    await expect(compra([{ insumo_id: ins.Cerveja, marca_id: caputo, pacotes: 1, conteudo: 350, unidade_conteudo: "ml", valor_linha_centavos: 500 }])).rejects.toThrow(/não é deste insumo/);
    const emb = (await um(`select id from public.marcas where nome = 'Embramex'`)).id;
    await q(`select public.definir_marca_em_uso($1)`, [emb]);
    expect((await q(`select nome from public.marcas where insumo_id = $1 and em_uso`, [ins.Farinha])).map((x) => x.nome)).toEqual(["Embramex"]);
    await q(`select public.definir_marca_em_uso($1)`, [caputo]);
  });

  it("ajuste por marca; excluir compra estorna cada marca", async () => {
    await q(`select public.registrar_ajuste_estoque($1, -500, 'perda', 'saco furou', '2026-10-12', $2)`, [ins.Farinha, caputo]);
    expect((await saldo(caputo)).q).toBe(2500);
    const c = await compra([{ insumo_id: ins.Farinha, marca_id: caputo, pacotes: 1, conteudo: 1, unidade_conteudo: "kg", valor_linha_centavos: 2000 }], "2026-10-13");
    expect((await saldo(caputo)).q).toBe(3500);
    await q(`select public.excluir_compra($1, 'teste')`, [c.id]);
    expect((await saldo(caputo)).q).toBe(2500);
  });

  it("lote começa com a marca em uso, aceita troca e baixa da marca usada", async () => {
    const ped = (await um(`select public.criar_pedido_manual('Ana', '11 98888-0001', 'retirada', null, '2026-10-30', null, $1::jsonb) as id`,
      [JSON.stringify([{ receita_id: rec.italiana, quantidade: 5, preco_centavos: 2000 }])])).id;
    const item = (await um(`select id from public.pedido_itens where pedido_id = $1`, [ped])).id;
    lote = (await um(`select public.criar_lote($1::jsonb) as id`, [JSON.stringify({ receita_id: rec.italiana, item_ids: [item] })])).id;
    const f = await um(`select marca_id, quantidade_real::float as q from public.lote_consumos where lote_id = $1 and insumo_id = $2`, [lote, ins.Farinha]);
    expect(f.marca_id).toBe(caputo);
    const cerveja = await um(`select marca_id from public.lote_consumos where lote_id = $1 and insumo_id = $2`, [lote, ins.Cerveja]);
    expect(cerveja.marca_id).toBeNull();
    // troca para "sem marca" explicitamente e volta para Caputo
    await q(`select public.salvar_apontamento_lote($1::jsonb)`, [JSON.stringify({ id: lote, consumos: [{ insumo_id: ins.Farinha, quantidade_real: f.q, marca_id: null }] })]);
    expect((await um(`select marca_id from public.lote_consumos where lote_id = $1 and insumo_id = $2`, [lote, ins.Farinha])).marca_id).toBeNull();
    await q(`select public.salvar_apontamento_lote($1::jsonb)`, [JSON.stringify({ id: lote, unidades_boas: 5, perdas: 1, consumos: [{ insumo_id: ins.Farinha, quantidade_real: 500, marca_id: caputo }] })]);
    await q(`select public.registrar_sessao($1, 'massa', '2026-10-14T10:00:00Z', '2026-10-14T10:30:00Z', null)`, [lote]);
    const antes = await saldo(caputo);
    await q(`select public.concluir_lote($1)`, [lote]);
    const depois = await saldo(caputo);
    expect(antes.q - depois.q).toBe(500);
    const custo = await um(`select custo_unitario_centavos::float as cu from public.lote_consumos where lote_id = $1 and insumo_id = $2`, [lote, ins.Farinha]);
    expect(custo.cu).toBeCloseTo(antes.v / antes.q, 4);
    const r = await um(`select lotes, bases_boas, perdas, compras, em_uso from public.marcas_resumo where id = $1`, [caputo]);
    expect(r).toMatchObject({ lotes: 1, bases_boas: 5, perdas: 1, compras: 2, em_uso: true });
  });

  it("tabela nutricional por combinação de marcas", async () => {
    const v = { kcal: 250, carboidratos_g: 50, acucares_totais_g: 0.5, acucares_adic_g: 0, proteinas_g: 8, gorduras_g: 1, saturadas_g: 0.2, trans_g: 0, fibras_g: 2, sodio_mg: 820 };
    const comb1 = { [ins.Farinha]: caputo, [ins.Cerveja]: null };
    await q(`select public.validar_nutricao($1, $2::jsonb, $3::jsonb, 'Farinha de trigo tipo 00, cerveja')`, [rec.italiana, JSON.stringify(v), JSON.stringify(comb1)]);
    await q(`select public.validar_nutricao($1, $2::jsonb, $3::jsonb, 'Farinha de trigo, cerveja')`, [rec.italiana, JSON.stringify({ ...v, kcal: 260 }), JSON.stringify({ [ins.Farinha]: null, [ins.Cerveja]: null })]);
    await q(`select public.validar_nutricao($1, $2::jsonb, $3::jsonb, 'Farinha de trigo tipo 00, cerveja.')`, [rec.italiana, JSON.stringify({ ...v, kcal: 255 }), JSON.stringify(comb1)]);
    const t = await q(`select chave, (nutricao->>'kcal')::int as kcal, ingredientes from public.receita_tabelas where receita_id = $1 order by kcal`, [rec.italiana]);
    expect(t).toHaveLength(2);
    const [a, b] = [ins.Farinha, ins.Cerveja].sort();
    const esperada = [a, b].map((k) => `${k}:${k === ins.Farinha ? caputo : "-"}`).join("|");
    expect(t[0]).toEqual({ chave: esperada, kcal: 255, ingredientes: "Farinha de trigo tipo 00, cerveja." });
    await expect(q(`select public.validar_nutricao($1, $2::jsonb, $3::jsonb, 'x y z')`, [rec.italiana, JSON.stringify(v), JSON.stringify({ [ins.Cerveja]: caputo })])).rejects.toThrow(/Marca inválida/);
  });

  it("anônimo e outro usuário não leem marcas", async () => {
    await expect(amb.como("anon", `select * from public.marcas`)).rejects.toThrow();
    expect(await amb.como("outro", `select * from public.marcas_resumo`)).toEqual([]);
  });
});
