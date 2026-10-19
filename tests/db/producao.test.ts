import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarAmbiente, HOST } from "./ambiente";

describe.skipIf(!HOST)("produção", () => {
  let amb: Awaited<ReturnType<typeof criarAmbiente>>;
  const ins: Record<string, string> = {};
  const rec: Record<string, string> = {};
  let pedidoA: string; // 2 italianas + 1 NY
  let pedidoB: string; // 3 italianas
  let itens: Record<string, string> = {};

  const q = <T = any>(sql: string, params: unknown[] = []) => amb.como<T>("admin", sql, params);
  const um = async <T = any>(sql: string, params: unknown[] = []) => (await q<T>(sql, params))[0];
  const saldo = async (nome: string) => {
    const s = await um(`select quantidade::float as q, valor_centavos::float as v from public.estoque_saldos where insumo_id = $1`, [ins[nome]]);
    return s ?? { q: 0, v: 0 };
  };

  beforeAll(async () => {
    amb = await criarAmbiente("liscia_producao");
    await amb.dono.query(`update public.configuracoes set valor_hora_centavos = 3000, semola_g_por_base = 7, molho_g_por_base = 0`);
    for (const r of (await amb.dono.query(`select id, nome from public.insumos`)).rows) ins[r.nome] = r.id;
    for (const r of (await amb.dono.query(`select id, codigo from public.receitas`)).rows) rec[r.codigo] = r.id;

    // Estoque: farinha 10 kg por R$ 50 (0,5 centavo/g), cerveja 3,5 L por R$ 35
    await q(`select public.salvar_compra($1::jsonb)`, [JSON.stringify({
      fornecedor_nome: "Atacadão", data: "2026-10-10", canal: "presencial", minutos_trabalho: 0,
      itens: [
        { insumo_id: ins["Farinha"], pacotes: 2, conteudo: 5, unidade_conteudo: "kg", valor_linha_centavos: 5000 },
        { insumo_id: ins["Cerveja"], pacotes: 10, conteudo: 350, unidade_conteudo: "ml", valor_linha_centavos: 3500 },
      ],
    })]);

    const item = (r: string, n: number) => ({ receita_id: rec[r], quantidade: n, preco_centavos: 2000 });
    pedidoA = (await um(`select public.criar_pedido_manual('Ana', '11 98888-0001', 'retirada', null, '2026-10-30', null, $1::jsonb) as id`,
      [JSON.stringify([item("italiana", 2), item("ny", 1)])])).id;
    pedidoB = (await um(`select public.criar_pedido_manual('Bia', '11 98888-0002', 'retirada', null, '2026-10-30', null, $1::jsonb) as id`,
      [JSON.stringify([item("italiana", 3)])])).id;
    for (const r of await q(`select i.id, p.cliente_nome, i.nome from public.pedido_itens i join public.pedidos p on p.id = i.pedido_id`))
      itens[`${r.cliente_nome}-${r.nome}`] = r.id;
  }, 60_000);
  afterAll(async () => amb && (await amb.encerrar()));

  let lote: string;

  it("cria lote de bases com ingredientes, auxiliares e uma sacola por pedido", async () => {
    lote = (await um(`select public.criar_lote($1::jsonb) as id`, [JSON.stringify({
      receita_id: rec.italiana, data_planejada: "2026-10-25",
      item_ids: [itens["Ana-Italiana clássica"], itens["Bia-Italiana clássica"]], bases_extras: 1,
    })])).id;
    const l = await um(`select bases_pedidos, bases_extras, massa_planejada_g::float as m, status from public.lotes where id = $1`, [lote]);
    expect(l).toEqual({ bases_pedidos: 5, bases_extras: 1, m: 1080, status: "planejado" });
    const c = Object.fromEntries((await q(`select i.nome, quantidade_prevista::float as qp from public.lote_consumos c join public.insumos i on i.id = c.insumo_id where lote_id = $1`, [lote]))
      .map((x) => [x.nome, x.qp]));
    expect(c["Farinha"]).toBeCloseTo(630.105, 2); // 6 × 180 / 857 × 500
    expect(c["Sêmola de abertura"]).toBe(42);
    expect(c["Saco para vácuo"]).toBe(6);
    expect(c["Sacola kraft"]).toBe(2);
    const p = await q(`select status_producao from public.pedidos order by numero`);
    // Planejar não muda o status: só o primeiro play
    expect(p.map((x) => x.status_producao)).toEqual(["confirmado", "confirmado"]);
    // item já em lote não entra em outro
    await expect(q(`select public.criar_lote($1::jsonb)`, [JSON.stringify({ receita_id: rec.italiana, item_ids: [itens["Bia-Italiana clássica"]] })]))
      .rejects.toThrow(/outro lote/);
  });

  it("cronômetro: só uma sessão aberta; geladeira não conta (teste 7)", async () => {
    const t = (h: string) => `2026-10-05T${h}:00-03:00`;
    await q(`select public.iniciar_etapa($1, 'massa', $2)`, [lote, t("08:00")]);
    const st = await q(`select status_producao from public.pedidos order by numero`);
    expect(st.map((x) => x.status_producao)).toEqual(["em_producao", "em_producao"]);
    // play em outra etapa pausa a anterior automaticamente
    await q(`select public.iniciar_etapa($1, 'bolear', $2)`, [lote, t("08:20")]);
    await q(`select public.iniciar_espera($1, 'descanso', $2)`, [lote, t("08:30")]); // pausa o trabalho
    const abertas = await um(`select count(*)::int as n from public.lote_sessoes where fim is null`);
    expect(abertas.n).toBe(0);
    await q(`select public.iniciar_espera($1, 'geladeira', $2)`, [lote, t("10:30")]);
    await q(`select public.iniciar_etapa($1, 'assar', $2)`, [lote, `2026-10-07T10:00:00-03:00`]);
    await q(`select public.pausar_producao($1)`, [`2026-10-07T11:00:00-03:00`]);
    await q(`select public.registrar_sessao($1, 'embalar', $2, $3)`, [lote, `2026-10-08T09:00:00-03:00`, `2026-10-08T09:30:00-03:00`]);
    // sobreposição é recusada
    await expect(q(`select public.registrar_sessao($1, 'limpeza', $2, $3)`, [lote, `2026-10-07T10:30:00-03:00`, `2026-10-07T10:45:00-03:00`]))
      .rejects.toThrow(/sobrepõe/);
    await q(`select public.iniciar_espera($1, 'freezer', $2)`, [lote, `2026-10-07T11:30:00-03:00`]);
    const l = await um(`select status, produzido_em::text as p, assado_em::text as a, congelado_em::text as c from public.lotes where id = $1`, [lote]);
    expect(l).toEqual({ status: "em_producao", p: "2026-10-05", a: "2026-10-07", c: "2026-10-07" });
    const d = await um(`select tipo, alvo_min, lembrete_min from public.lote_esperas where lote_id = $1 and tipo = 'descanso'`, [lote]);
    expect(d).toEqual({ tipo: "descanso", alvo_min: 120, lembrete_min: 60 });
  });

  it("não conclui sem bases boas suficientes para os pedidos", async () => {
    await q(`select public.salvar_apontamento_lote($1::jsonb)`, [JSON.stringify({ id: lote, unidades_boas: 4, perdas: 2 })]);
    await expect(q(`select public.concluir_lote($1)`, [lote])).rejects.toThrow(/reposição/);
  });

  it("conclui: baixa estoque pelo custo médio, horas ativas e custo por base boa", async () => {
    const farinhaPrev = (await um(`select quantidade_prevista::float as q from public.lote_consumos where lote_id = $1 and insumo_id = $2`, [lote, ins["Farinha"]])).q;
    await q(`select public.salvar_apontamento_lote($1::jsonb)`, [JSON.stringify({
      id: lote, unidades_boas: 5, perdas: 1,
      consumos: [{ insumo_id: ins["Farinha"], quantidade_real: 700 }, { insumo_id: ins["Tomate"], quantidade_real: 0 }],
    })]);
    await q(`select public.concluir_lote($1)`, [lote]);
    const l = await um(`select status, minutos_ativos::float as m, custo_mao_obra_centavos as mo, custo_materiais_centavos::float as mat,
                               custo_total_centavos::float as tot, custo_por_unidade_centavos::float as un, valor_hora_centavos as vh
                          from public.lotes where id = $1`, [lote]);
    // 20 massa + 10 bolear + 60 assar + 30 embalar = 120 min; geladeira/descanso/freezer fora
    expect(l.m).toBe(120);
    expect(l.mo).toBe(6000);
    expect(l.vh).toBe(3000);
    expect(l.status).toBe("concluido");
    // farinha 700 g × 0,5 = 350 centavos; cerveja ~220,5 ml × 1 = ~220,5
    const farinha = await um(`select custo_unitario_centavos::float as cu, custo_total_centavos::float as ct from public.lote_consumos where lote_id = $1 and insumo_id = $2`, [lote, ins["Farinha"]]);
    expect(farinha).toEqual({ cu: 0.5, ct: 350 });
    expect(l.tot).toBeCloseTo(l.mat + 6000, 4);
    expect(l.un).toBeCloseTo(l.tot / 5, 4); // perdas encarecem a base boa
    expect((await saldo("Farinha")).q).toBe(10000 - 700);
    expect(farinhaPrev).toBeGreaterThan(0);
    // Ana ainda tem a NY sem lote: continua em produção; Bia fica pronta
    const st = await q(`select cliente_nome, status_producao from public.pedidos order by numero`);
    expect(st).toEqual([{ cliente_nome: "Ana", status_producao: "em_producao" }, { cliente_nome: "Bia", status_producao: "pronto" }]);
    // lote concluído não aceita mais cronômetro
    await expect(q(`select public.iniciar_etapa($1, 'limpeza')`, [lote])).rejects.toThrow(/concluído/);
  });

  it("concluir uma compra posterior não reescreve o custo do lote", async () => {
    await q(`select public.salvar_compra($1::jsonb)`, [JSON.stringify({
      fornecedor_nome: "Atacadão", data: "2026-10-28", canal: "presencial",
      itens: [{ insumo_id: ins["Farinha"], pacotes: 1, conteudo: 1, unidade_conteudo: "kg", valor_linha_centavos: 2000 }],
    })]);
    const farinha = await um(`select custo_unitario_centavos::float as cu from public.lote_consumos where lote_id = $1 and insumo_id = $2`, [lote, ins["Farinha"]]);
    expect(farinha.cu).toBe(0.5);
  });

  it("preparo de molho: consome tomate e devolve molho ao estoque pelo custo dos materiais", async () => {
    await amb.dono.query(`insert into public.receitas (codigo, nome, tipo, produz_insumo_id) values ('molho', 'Molho caseiro', 'preparo', $1)`, [ins["Molho de marcação"]]);
    const molho = (await amb.dono.query(`select id from public.receitas where codigo = 'molho'`)).rows[0].id;
    await expect(q(`select public.nova_versao_receita($1, null, $2::jsonb)`, [molho, JSON.stringify([{ insumo_id: ins["Tomate"], quantidade: 1000 }])]))
      .rejects.toThrow(/rende/);
    await q(`select public.nova_versao_receita($1, null, $2::jsonb, null, 800)`, [molho, JSON.stringify([
      { insumo_id: ins["Tomate"], quantidade: 1000 }, { insumo_id: ins["Sal"], quantidade: 10 },
    ])]);
    await q(`select public.salvar_compra($1::jsonb)`, [JSON.stringify({
      fornecedor_nome: "Feira", data: "2026-10-20", canal: "presencial",
      itens: [{ insumo_id: ins["Tomate"], pacotes: 1, conteudo: 3, unidade_conteudo: "kg", valor_linha_centavos: 1500 }],
    })]);
    const lm = (await um(`select public.criar_lote($1::jsonb) as id`, [JSON.stringify({ receita_id: molho, quantidade_planejada: 1600 })])).id;
    const c = await um(`select quantidade_prevista::float as q from public.lote_consumos where lote_id = $1 and insumo_id = $2`, [lm, ins["Tomate"]]);
    expect(c.q).toBe(2000);
    await q(`select public.registrar_sessao($1, 'molho', $2, $3)`, [lm, `2026-10-01T09:00:00-03:00`, `2026-10-01T10:00:00-03:00`]);
    await expect(q(`select public.concluir_lote($1)`, [lm])).rejects.toThrow(/quanto foi produzido/);
    await q(`select public.salvar_apontamento_lote($1::jsonb)`, [JSON.stringify({ id: lm, quantidade_produzida: 1500 })]);
    await q(`select public.concluir_lote($1)`, [lm]);
    const s = await saldo("Molho de marcação");
    expect(s.q).toBe(1500);
    expect(s.v).toBeCloseTo(1000, 2); // 2 kg de tomate a 0,5 centavo/g; sal sem custo cadastrado
    expect((await saldo("Tomate")).q).toBe(1000);
  });

  it("cancelar lote libera os itens e devolve o pedido para confirmado", async () => {
    const l2 = (await um(`select public.criar_lote($1::jsonb) as id`, [JSON.stringify({ receita_id: rec.ny, item_ids: [itens["Ana-NY style"]] })])).id;
    const sac = await um(`select count(*)::int as n from public.lote_consumos c join public.insumos i on i.id = c.insumo_id where c.lote_id = $1 and i.uso_auxiliar = 'sacola'`, [l2]);
    expect(sac.n).toBe(0); // Ana já teve a sacola no primeiro lote
    await expect(q(`select public.cancelar_lote($1, '')`, [l2])).rejects.toThrow(/motivo/);
    await q(`select public.cancelar_lote($1, 'erro de planejamento')`, [l2]);
    const it = await um(`select lote_id from public.pedido_itens where id = $1`, [itens["Ana-NY style"]]);
    expect(it.lote_id).toBeNull();
  });

  it("só o administrador acessa a produção", async () => {
    expect(await amb.como("outro", `select * from public.lotes`)).toHaveLength(0);
    await expect(amb.como("outro", `select public.criar_lote('{}'::jsonb)`)).rejects.toThrow(/Acesso negado/);
    await expect(amb.como("anon", `select * from public.lote_sessoes`)).rejects.toThrow(/permission denied/);
  });

  it("tabela nutricional: só o admin valida e todos os campos são obrigatórios", async () => {
    const v = { kcal: 250, carboidratos_g: 50, acucares_totais_g: 0.5, acucares_adic_g: 0, proteinas_g: 8, gorduras_g: 1, saturadas_g: 0.2, trans_g: 0, fibras_g: 2, sodio_mg: 820 };
    await expect(q(`select public.validar_nutricao($1, $2::jsonb)`, [rec.italiana, JSON.stringify({ ...v, sodio_mg: null })])).rejects.toThrow(/sodio_mg/);
    await expect(amb.como("outro", `select public.validar_nutricao($1, $2::jsonb)`, [rec.italiana, JSON.stringify(v)])).rejects.toThrow(/Acesso negado/);
    await expect(q(`select public.validar_nutricao($1, $2::jsonb)`, [rec.italiana, JSON.stringify(v)])).rejects.toThrow(/ingredientes/);
    await q(`select public.validar_nutricao($1, $2::jsonb, '{}'::jsonb, 'Farinha de trigo, cerveja, água, sal e fermento.')`, [rec.italiana, JSON.stringify(v)]);
    const r = await um(`select (t.nutricao->>'sodio_mg')::int as na, t.receita_versao_id = r.versao_atual_id as mesma, t.chave, r.rotulo_alergenicos
                          from public.receita_tabelas t join public.receitas r on r.id = t.receita_id where t.receita_id = $1`, [rec.italiana]);
    expect(r).toEqual({ na: 820, mesma: true, chave: "", rotulo_alergenicos: "ALÉRGICOS: CONTÉM TRIGO E CEVADA. CONTÉM GLÚTEN." });
  });
});
