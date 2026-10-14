import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarAmbiente, HOST } from "./ambiente";

describe.skipIf(!HOST)("compras e estoque", () => {
  let amb: Awaited<ReturnType<typeof criarAmbiente>>;
  const ins: Record<string, string> = {};

  const salvar = (p: object) =>
    amb.como<{ id: string }>("admin", `select public.salvar_compra($1::jsonb) as id`, [JSON.stringify(p)]).then((r) => r[0].id);
  const saldo = async (nome: string) => {
    const [s] = await amb.como("admin",
      `select quantidade::float as q, valor_centavos::float as v from public.estoque_saldos where insumo_id = $1`, [ins[nome]]);
    return s ?? { q: 0, v: 0 };
  };

  beforeAll(async () => {
    amb = await criarAmbiente("liscia_compras");
    await amb.dono.query(`update public.configuracoes set valor_hora_centavos = 2500`);
    for (const r of (await amb.dono.query(`select id, nome from public.insumos`)).rows) ins[r.nome] = r.id;
  }, 60_000);
  afterAll(async () => amb && (await amb.encerrar()));

  const base = (itens: object[], extra: object = {}) => ({
    fornecedor_nome: "Atacadão",
    data: "2026-10-10",
    canal: "presencial",
    minutos_trabalho: 30,
    frete_centavos: 1000,
    servico_centavos: 200,
    outras_centavos: 0,
    desconto_centavos: 300,
    itens,
    ...extra,
  });

  let compraId: string;

  it("rateia extras, converte embalagens e conta o tempo uma vez (testes 4, 5 e 6)", async () => {
    compraId = await salvar(base([
      { insumo_id: ins["Farinha"], descricao_original: "FARINHA TRIGO 1KG", pacotes: 2, conteudo: 1, unidade_conteudo: "kg", valor_linha_centavos: 4000 },
      { insumo_id: ins["Cerveja"], descricao_original: "CERVEJA LATA 350ML", pacotes: 4, conteudo: 350, unidade_conteudo: "ml", valor_linha_centavos: 2000 },
    ]));
    const [c] = await amb.como("admin", `select * from public.compras where id = $1`, [compraId]);
    expect(c.subtotal_centavos).toBe(6000);
    expect(c.total_centavos).toBe(6900);
    expect(c.valor_hora_centavos).toBe(2500);
    expect(c.custo_tempo_centavos).toBe(1250);
    const itens = await amb.como("admin",
      `select quantidade_base::float as q, custo_final_centavos as c from public.compra_itens where compra_id = $1 order by ordem`, [compraId]);
    expect(itens).toEqual([{ q: 2000, c: 4600 }, { q: 1400, c: 2300 }]);
    expect(await saldo("Farinha")).toEqual({ q: 2000, v: 4600 });
    expect(await saldo("Cerveja")).toEqual({ q: 1400, v: 2300 });
  });

  it("distribui o resto de centavos sem diferença", async () => {
    const id = await salvar(base([
      { insumo_id: ins["Sal"], pacotes: 1, conteudo: 1, unidade_conteudo: "kg", valor_linha_centavos: 1000 },
      { insumo_id: ins["Azeite"], pacotes: 1, conteudo: 500, unidade_conteudo: "ml", valor_linha_centavos: 1000 },
      { insumo_id: ins["Etiqueta"], pacotes: 1, conteudo: 100, unidade_conteudo: "un", valor_linha_centavos: 1000 },
    ], { frete_centavos: 100, servico_centavos: 0, desconto_centavos: 0 }));
    const itens = await amb.como("admin", `select custo_final_centavos as c from public.compra_itens where compra_id = $1`, [id]);
    expect(itens.reduce((s, i) => s + i.c, 0)).toBe(3100);
    await amb.como("admin", `select public.excluir_compra($1, 'teste')`, [id]);
  });

  it("editar a compra não duplica o estoque", async () => {
    const [{ versao }] = await amb.como("admin", `select versao from public.compras where id = $1`, [compraId]);
    await salvar({
      ...base([
        { insumo_id: ins["Farinha"], pacotes: 3, conteudo: 1, unidade_conteudo: "kg", valor_linha_centavos: 6000 },
      ], { frete_centavos: 0, servico_centavos: 0, desconto_centavos: 0 }),
      id: compraId,
      versao,
    });
    expect(await saldo("Farinha")).toEqual({ q: 3000, v: 6000 });
    expect(await saldo("Cerveja")).toEqual({ q: 0, v: 0 });
    // versão antiga é recusada (outra aba)
    await expect(salvar({ ...base([{ insumo_id: ins["Farinha"], pacotes: 1, conteudo: 1, unidade_conteudo: "kg", valor_linha_centavos: 1 }]), id: compraId, versao }))
      .rejects.toThrow(/outra aba/);
  });

  it("custo médio móvel combina compras", async () => {
    await salvar(base([
      { insumo_id: ins["Farinha"], pacotes: 1, conteudo: 1000, unidade_conteudo: "g", valor_linha_centavos: 3000 },
    ], { frete_centavos: 0, servico_centavos: 0, desconto_centavos: 0, data: "2026-10-12" }));
    const s = await saldo("Farinha");
    expect(s).toEqual({ q: 4000, v: 9000 });
    const [{ c }] = await amb.como("admin", `select public.custo_unitario_atual($1)::float as c`, [ins["Farinha"]]);
    expect(c).toBeCloseTo(2.25, 6); // centavos por grama
  });

  it("perda e ajuste exigem motivo e usam o custo médio", async () => {
    await expect(amb.como("admin", `select public.registrar_ajuste_estoque($1, -100, 'perda', '')`, [ins["Farinha"]]))
      .rejects.toThrow(/motivo/);
    await amb.como("admin", `select public.registrar_ajuste_estoque($1, -400, 'perda', 'Saco rasgado')`, [ins["Farinha"]]);
    expect(await saldo("Farinha")).toEqual({ q: 3600, v: 8100 });
  });

  it("excluir a compra estorna e mantém o histórico", async () => {
    await amb.como("admin", `select public.excluir_compra($1, 'lançada errada')`, [compraId]);
    await amb.como("admin", `select public.excluir_compra($1, 'de novo')`, [compraId]); // idempotente
    const [c] = await amb.como("admin", `select cancelada from public.compras where id = $1`, [compraId]);
    expect(c.cancelada).toBe(true);
    expect((await saldo("Farinha")).q).toBe(600);
    await expect(amb.como("admin", `select public.salvar_compra($1::jsonb)`, [JSON.stringify({ ...base([{ insumo_id: ins["Sal"], pacotes: 1, conteudo: 1, unidade_conteudo: "kg", valor_linha_centavos: 1 }]), id: compraId })]))
      .rejects.toThrow(/excluída/);
  });

  it("valida unidade compatível e desconto excessivo", async () => {
    await expect(salvar(base([{ insumo_id: ins["Farinha"], pacotes: 1, conteudo: 1, unidade_conteudo: "l", valor_linha_centavos: 500 }])))
      .rejects.toThrow(/g ou kg/);
    await expect(salvar(base([{ insumo_id: ins["Farinha"], pacotes: 1, conteudo: 1, unidade_conteudo: "kg", valor_linha_centavos: 100 }], { desconto_centavos: 5000 })))
      .rejects.toThrow(/desconto/);
  });

  it("movimentos são imutáveis e só o admin acessa", async () => {
    await expect(amb.dono.query(`delete from public.estoque_movimentos`)).rejects.toThrow(/não podem ser alterados/);
    expect(await amb.como("outro", `select * from public.compras`)).toHaveLength(0);
    await expect(amb.como("anon", `select * from public.estoque_saldos`)).rejects.toThrow(/permission denied/);
    await expect(amb.como("outro", `select public.salvar_compra('{}'::jsonb)`)).rejects.toThrow(/Acesso negado/);
    await expect(amb.como("admin", `insert into public.estoque_movimentos (insumo_id, tipo, quantidade, valor_centavos, data) values ($1, 'ajuste', 1, 0, '2026-10-10')`, [ins["Sal"]]))
      .rejects.toThrow(/row-level security|permission denied/);
  });

  it("reaproveita o fornecedor pelo nome", async () => {
    await salvar(base([{ insumo_id: ins["Sal"], pacotes: 1, conteudo: 1, unidade_conteudo: "kg", valor_linha_centavos: 500 }], { fornecedor_nome: " atacadão " }));
    const f = await amb.como("admin", `select count(*)::int as n from public.fornecedores`);
    expect(f[0].n).toBe(1);
  });
});
