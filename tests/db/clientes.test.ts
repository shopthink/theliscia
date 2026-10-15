import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarAmbiente, HOST } from "./ambiente";

describe.skipIf(!HOST)("clientes (CRM)", () => {
  let amb: Awaited<ReturnType<typeof criarAmbiente>>;
  let receita: string;
  const adm = <T = any>(sql: string, p: unknown[] = []) => amb.como<T>("admin", sql, p);
  const pedido = async (nome: string, tel: string, qtd: number, preco = 2000) =>
    (await adm(`select public.criar_pedido_manual($1, $2, 'retirada', null, '2026-10-30', null, $3::jsonb) as id`,
      [nome, tel, JSON.stringify([{ receita_id: receita, quantidade: qtd, preco_centavos: preco }])]))[0].id;
  const resumo = async (tel: string) => (await adm(`select * from public.clientes_resumo where telefone = $1`, [tel]))[0];

  beforeAll(async () => {
    amb = await criarAmbiente("liscia_crm");
    receita = (await amb.dono.query(`select id from public.receitas where codigo = 'italiana'`)).rows[0].id;
  }, 60_000);
  afterAll(async () => amb && (await amb.encerrar()));

  it("calcula pedidos, bases, total e segmento", async () => {
    await pedido("Ana", "11 90000-0001", 3);
    await pedido("Ana", "11 90000-0001", 2);
    await pedido("Bia", "11 90000-0002", 4);
    const cancelado = await pedido("Cris", "11 90000-0003", 3);
    await adm(`update public.pedidos set status_producao = 'cancelado' where id = $1`, [cancelado]);
    expect(await resumo("11900000001")).toMatchObject({ pedidos: 2, bases: 5, segmento: "recorrente", origem: "pedido", aceita_novidades: false });
    expect(Number((await resumo("11900000001")).total_centavos)).toBe(10000);
    expect(await resumo("11900000002")).toMatchObject({ pedidos: 1, segmento: "novo" });
    expect(await resumo("11900000003")).toMatchObject({ pedidos: 0, segmento: "lead" });
  });

  it("sumido depende de dias_sumido; fã é quem mais compra com 2+ pedidos", async () => {
    await amb.dono.query(`update public.pedidos set criado_em = now() - interval '50 days' where cliente_nome = 'Bia'`);
    expect((await resumo("11900000002")).segmento).toBe("sumido");
    await amb.dono.query(`update public.configuracoes set dias_sumido = 60`);
    expect((await resumo("11900000002")).segmento).toBe("novo");
    expect((await resumo("11900000001")).fa).toBe(true);
    expect((await resumo("11900000002")).fa).toBe(false);
  });

  it("lead manual pelo admin; anônimo não lê", async () => {
    await adm(`insert into public.clientes (nome, telefone, origem, aceita_novidades, aceite_em, aceite_origem) values ('Dani', '11900000004', 'instagram', true, now(), 'manual')`);
    expect(await resumo("11900000004")).toMatchObject({ segmento: "lead", origem: "instagram", aceita_novidades: true });
    await expect(amb.como("anon", `select * from public.clientes_resumo`)).rejects.toThrow();
    expect(await amb.como("outro", `select * from public.clientes_resumo`)).toEqual([]);
  });

  it("aceite pelo formulário só liga e só o servidor chama", async () => {
    await expect(adm(`select public.registrar_aceite_novidades('11 90000-0002')`)).rejects.toThrow();
    await amb.como("servico", `select public.registrar_aceite_novidades('(11) 90000-0002', 'pedido')`);
    const c = (await amb.dono.query(`select aceita_novidades, aceite_origem, aceite_em is not null as tem from public.clientes where telefone = '11900000002'`)).rows[0];
    expect(c).toEqual({ aceita_novidades: true, aceite_origem: "pedido", tem: true });
    // Novo pedido não desmarca
    await pedido("Bia", "11 90000-0002", 3);
    expect((await resumo("11900000002")).aceita_novidades).toBe(true);
  });
});
