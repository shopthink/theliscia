/**
 * Testes de integração do banco: aplicam as migrações num PostgreSQL de verdade
 * (com um "stub" mínimo do Supabase) e verificam as regras críticas da fase 1.
 *
 * Rodar:  TEST_PGHOST=/var/run/postgresql TEST_PGPORT=5432 npm run test:db
 * Sem TEST_PGHOST os testes são pulados.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const HOST = process.env.TEST_PGHOST;
const PORT = Number(process.env.TEST_PGPORT ?? 5432);
const DB = `liscia_test_${Date.now()}`;
const ROOT = join(__dirname, "..", "..");

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const OUTRO_ID = "00000000-0000-4000-8000-000000000002";

type Papel = "anon" | "outro" | "admin" | "servico";

let dono: Client; // superusuário, só para preparar dados
const conexoes: Client[] = [];

async function conectar(user: string, database = DB) {
  const c = new Client({ host: HOST, port: PORT, user, database });
  await c.connect();
  conexoes.push(c);
  return c;
}

/** Executa SQL num papel específico, como o PostgREST faria. */
async function como<T = any>(papel: Papel, sql: string, params: unknown[] = [], c?: Client) {
  const cli = c ?? (await conectar("authenticator"));
  const claims =
    papel === "admin" ? { sub: ADMIN_ID, role: "authenticated" }
    : papel === "outro" ? { sub: OUTRO_ID, role: "authenticated" }
    : papel === "servico" ? { role: "service_role" }
    : { role: "anon" };
  const role = papel === "admin" || papel === "outro" ? "authenticated" : papel === "servico" ? "service_role" : "anon";
  await cli.query("begin");
  try {
    await cli.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await cli.query(`set local role ${role}`);
    const r = await cli.query(sql, params);
    await cli.query("commit");
    return r.rows as T[];
  } catch (e) {
    await cli.query("rollback");
    throw e;
  } finally {
    if (!c) await cli.end();
  }
}

const SP = (iso: string) => iso; // datas já em UTC nos testes

let campanhaId: string;
let prodItaliana: string;
let prodNY: string;
let receitaItaliana: string;
let receitaNY: string;

async function criarSolicitacao(itens: unknown, agora = "2026-10-10T15:00:00Z", extra: Partial<Record<string, string>> = {}) {
  const r = await como<{ id: string; token: string; numero: number }>(
    "servico",
    `select * from public.criar_solicitacao($1::jsonb, $2, $3, $4, $5, $6, $7, $8::timestamptz)`,
    [
      JSON.stringify(itens),
      extra.nome ?? "Maria Teste",
      extra.telefone ?? "(11) 98888-7777",
      extra.modalidade ?? "retirada",
      extra.endereco ?? null,
      null,
      extra.origem ?? null,
      agora,
    ],
  );
  return r[0];
}

describe.skipIf(!HOST)("banco de dados", () => {
  beforeAll(async () => {
    const sup = new Client({ host: HOST, port: PORT, user: "postgres", database: "postgres" });
    await sup.connect();
    await sup.query(`create database ${DB}`);
    await sup.end();

    dono = await conectar("postgres");
    await dono.query(readFileSync(join(ROOT, "tests/db/supabase-stub.sql"), "utf8"));
    const dir = join(ROOT, "supabase/migrations");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      await dono.query("begin");
      await dono.query(readFileSync(join(dir, f), "utf8"));
      await dono.query("commit");
    }
    await dono.query(`insert into auth.users (id, email) values ($1, 'dono@x'), ($2, 'outro@x')`, [ADMIN_ID, OUTRO_ID]);
    await dono.query(`insert into public.admins (user_id) values ($1)`, [ADMIN_ID]);

    const rec = await dono.query(`select id, codigo from public.receitas`);
    receitaItaliana = rec.rows.find((r) => r.codigo === "italiana").id;
    receitaNY = rec.rows.find((r) => r.codigo === "ny").id;

    // Campanha criada pelo administrador (via RLS), primeiro pausada
    const [c] = await como("admin",
      `insert into public.campanhas (nome, abre_em, fecha_em, entrega_em, pedido_minimo, percentual_sinal)
       values ('Outubro/2026', '2026-10-01', '2026-10-20', '2026-10-30', 3, 50) returning id`);
    campanhaId = c.id;
  }, 60_000);

  afterAll(async () => {
    for (const c of conexoes) await c.end().catch(() => {});
    const sup = new Client({ host: HOST, port: PORT, user: "postgres", database: "postgres" });
    await sup.connect();
    await sup.query(`drop database if exists ${DB} with (force)`);
    await sup.end();
  });

  it("não ativa vendas sem Pix, favorecido e produtos com preço", async () => {
    await expect(como("admin", `update public.campanhas set ativa = true where id = $1`, [campanhaId]))
      .rejects.toThrow(/chave Pix/);
    await como("admin", `update public.campanhas set pix_chave = 'chave@exemplo', pix_favorecido = 'Fulano' where id = $1`, [campanhaId]);
    await expect(como("admin", `update public.campanhas set ativa = true where id = $1`, [campanhaId]))
      .rejects.toThrow(/produto/);

    const [a] = await como("admin",
      `insert into public.campanha_produtos (campanha_id, receita_id, nome, preco_centavos, ordem)
       values ($1, $2, 'Base Italiana', 2000, 1) returning id`, [campanhaId, receitaItaliana]);
    const [b] = await como("admin",
      `insert into public.campanha_produtos (campanha_id, receita_id, nome, preco_centavos, ordem)
       values ($1, $2, 'Base NY', 2000, 2) returning id`, [campanhaId, receitaNY]);
    prodItaliana = a.id;
    prodNY = b.id;
    await como("admin", `update public.campanhas set ativa = true where id = $1`, [campanhaId]);
    const [{ ativa }] = await como("admin", `select ativa from public.campanhas where id = $1`, [campanhaId]);
    expect(ativa).toBe(true);
  });

  it("rejeita datas incoerentes na campanha", async () => {
    await expect(como("admin",
      `insert into public.campanhas (nome, abre_em, fecha_em, entrega_em) values ('X', '2026-11-10', '2026-11-01', '2026-11-30')`))
      .rejects.toThrow(/campanha_datas_abertura/);
    await expect(como("admin",
      `insert into public.campanhas (nome, abre_em, fecha_em, entrega_em) values ('X', '2026-11-01', '2026-11-20', '2026-11-19')`))
      .rejects.toThrow(/campanha_datas_entrega/);
  });

  it("visitante e conta não autorizada não leem dados administrativos", async () => {
    await expect(como("anon", `select * from public.pedidos`)).rejects.toThrow(/permission denied/);
    await expect(como("anon", `select * from public.campanhas`)).rejects.toThrow(/permission denied/);
    await expect(
      como("anon", `select * from public.criar_solicitacao('[]'::jsonb, 'a', 'b', 'retirada', null, null)`),
    ).rejects.toThrow(/permission denied/);
    expect(await como("outro", `select * from public.campanhas`)).toHaveLength(0);
    expect(await como("outro", `select * from public.solicitacoes`)).toHaveLength(0);
    await expect(
      como("outro", `select * from public.criar_solicitacao('[]'::jsonb, 'a', 'b', 'retirada', null, null)`),
    ).rejects.toThrow(/permission denied/);
  });

  it("exige o mínimo de bases somando os tipos (teste 1)", async () => {
    await expect(criarSolicitacao([{ produto_id: prodItaliana, quantidade: 2 }])).rejects.toThrow(/mínimo é de 3/);
    const s = await criarSolicitacao([
      { produto_id: prodItaliana, quantidade: 2 },
      { produto_id: prodNY, quantidade: 1 },
    ]);
    expect(s.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("respeita a janela até 23h59 de São Paulo (teste 2)", async () => {
    const itens = [{ produto_id: prodItaliana, quantidade: 3 }];
    // 20/10 23:59 em SP = 21/10 02:59 UTC
    await expect(criarSolicitacao(itens, SP("2026-10-21T02:59:00Z"))).resolves.toBeTruthy();
    await expect(criarSolicitacao(itens, SP("2026-10-21T03:00:00Z"))).rejects.toThrow(/fechados/);
    await expect(criarSolicitacao(itens, SP("2026-09-30T23:00:00Z"))).rejects.toThrow(/fechados/);
  });

  it("calcula total e sinal no servidor, ignorando preço enviado (testes 3 e 9)", async () => {
    const s = await criarSolicitacao([{ produto_id: prodItaliana, quantidade: 3, preco_centavos: 1 }]);
    const [row] = await como("admin", `select * from public.solicitacoes where id = $1`, [s.id]);
    expect(row.total_centavos).toBe(6000);
    expect(row.sinal_centavos).toBe(3000);
    expect(row.saldo_centavos).toBe(3000);
    expect(row.pix_chave).toBe("chave@exemplo");
    expect(row.entrega_em.toISOString().slice(0, 10)).toBe("2026-10-30");

    // Muda o preço da campanha: a solicitação já iniciada não muda
    await como("admin", `update public.campanha_produtos set preco_centavos = 2500 where id = $1`, [prodItaliana]);
    const [depois] = await como("admin", `select total_centavos from public.solicitacoes where id = $1`, [s.id]);
    expect(depois.total_centavos).toBe(6000);
    await como("admin", `update public.campanha_produtos set preco_centavos = 2000 where id = $1`, [prodItaliana]);
  });

  it("comprovante gera pendência, nunca aprovação automática", async () => {
    const s = await criarSolicitacao([{ produto_id: prodNY, quantidade: 3 }]);
    await expect(
      como("servico", `select public.registrar_comprovante($1, $2, 'image/png', 1000, '2026-10-10T16:00:00Z')`,
        [s.token, `solicitacoes/outra/arquivo.png`]),
    ).rejects.toThrow(/inválido/);
    await como("servico", `select public.registrar_comprovante($1, $2, 'image/png', 1000, '2026-10-10T16:00:00Z')`,
      [s.token, `solicitacoes/${s.id}/a.png`]);
    const [row] = await como("admin", `select status, pedido_id from public.solicitacoes where id = $1`, [s.id]);
    expect(row.status).toBe("em_conferencia");
    expect(row.pedido_id).toBeNull();
    const pedidos = await como("admin", `select 1 from public.pedidos where solicitacao_id = $1`, [s.id]);
    expect(pedidos).toHaveLength(0);
  });

  it("recusa comprovante depois do prazo configurado", async () => {
    const s = await criarSolicitacao([{ produto_id: prodNY, quantidade: 3 }], "2026-10-10T15:00:00Z");
    await expect(
      como("servico", `select public.registrar_comprovante($1, $2, 'image/png', 1000, '2026-10-11T15:00:01Z')`,
        [s.token, `solicitacoes/${s.id}/a.png`]),
    ).rejects.toThrow(/prazo/);
  });

  it("aprovar duas vezes, inclusive em paralelo, cria um único pedido (teste 8)", async () => {
    const s = await criarSolicitacao([
      { produto_id: prodItaliana, quantidade: 2 },
      { produto_id: prodNY, quantidade: 1 },
    ]);
    await como("servico", `select public.registrar_comprovante($1, $2, 'application/pdf', 5000, '2026-10-10T16:00:00Z')`,
      [s.token, `solicitacoes/${s.id}/c.pdf`]);

    const [c1, c2] = await Promise.all([conectar("authenticator"), conectar("authenticator")]);
    const sql = `select public.aprovar_solicitacao($1, 3000, null) as pedido`;
    const [r1, r2] = await Promise.all([como("admin", sql, [s.id], c1), como("admin", sql, [s.id], c2)]);
    expect(r1[0].pedido).toBe(r2[0].pedido);
    const [r3] = await como("admin", sql, [s.id]);
    expect(r3.pedido).toBe(r1[0].pedido);

    const pedidos = await como("admin", `select * from public.pedidos where solicitacao_id = $1`, [s.id]);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].total_centavos).toBe(6000);
    expect(pedidos[0].recebido_centavos).toBe(3000);
    expect(pedidos[0].status_pagamento).toBe("sinal_confirmado");
    expect(pedidos[0].status_producao).toBe("confirmado");
    const pags = await como("admin", `select * from public.pagamentos where pedido_id = $1`, [pedidos[0].id]);
    expect(pags).toHaveLength(1);
    const itens = await como("admin", `select * from public.pedido_itens where pedido_id = $1 order by nome`, [pedidos[0].id]);
    expect(itens.map((i) => [i.nome, i.quantidade])).toEqual([["Base Italiana", 2], ["Base NY", 1]]);
    const conf = await como("admin", `select * from public.conferencias where solicitacao_id = $1`, [s.id]);
    expect(conf).toHaveLength(1);
    expect(conf[0].admin_id).toBe(ADMIN_ID);

    await expect(como("admin", `select public.recusar_solicitacao($1, 'x')`, [s.id])).rejects.toThrow(/já foi aprovada/);
  });

  it("conta sem permissão não aprova; recusa não vira pedido", async () => {
    const s = await criarSolicitacao([{ produto_id: prodNY, quantidade: 3 }]);
    await expect(como("outro", `select public.aprovar_solicitacao($1, 6000)`, [s.id])).rejects.toThrow(/Acesso negado/);
    await como("admin", `select public.recusar_solicitacao($1, 'Pix não localizado')`, [s.id]);
    await como("admin", `select public.recusar_solicitacao($1, 'de novo')`, [s.id]); // idempotente
    await expect(como("admin", `select public.aprovar_solicitacao($1, 6000)`, [s.id])).rejects.toThrow(/recusada/);
    const [row] = await como("admin", `select status, pedido_id from public.solicitacoes where id = $1`, [s.id]);
    expect(row).toEqual({ status: "recusada", pedido_id: null });
  });

  it("não aceita a mesma transação bancária em dois pagamentos", async () => {
    const a = await criarSolicitacao([{ produto_id: prodNY, quantidade: 3 }]);
    const b = await criarSolicitacao([{ produto_id: prodNY, quantidade: 3 }]);
    await como("admin", `select public.aprovar_solicitacao($1, 6000, 'E123ABC')`, [a.id]);
    await expect(como("admin", `select public.aprovar_solicitacao($1, 6000, ' e123abc ')`, [b.id])).rejects.toThrow(/já foi usada/);
  });

  it("pedido manual com pagamento integral e status separados", async () => {
    const [{ id }] = await como("admin",
      `select public.criar_pedido_manual('João', '11 97777-6666', 'entrega', 'Rua A, 100 - Centro', '2026-10-30', null,
         $1::jsonb, null, '{"valor_centavos": 4000, "metodo": "dinheiro"}'::jsonb) as id`,
      [JSON.stringify([{ receita_id: receitaItaliana, quantidade: 2, preco_centavos: 2000 }])]);
    const [p] = await como("admin", `select * from public.pedidos where id = $1`, [id]);
    expect(p.origem).toBe("manual");
    expect(p.total_centavos).toBe(4000);
    expect(p.status_pagamento).toBe("integral_confirmado");
    expect(p.cliente_telefone).toBe("11977776666");
  });

  it("nova versão de receita não altera pedidos existentes", async () => {
    const [antes] = await como("admin",
      `select i.receita_versao_id from public.pedido_itens i join public.receitas r on r.id = i.receita_id
        where r.codigo = 'italiana' limit 1`);
    const ings = await como("admin",
      `select insumo_id, quantidade, densidade_g from public.receita_versao_ingredientes where receita_versao_id = $1`,
      [antes.receita_versao_id]);
    const [{ nova }] = await como("admin", `select public.nova_versao_receita($1, 200, $2::jsonb) as nova`,
      [receitaItaliana, JSON.stringify(ings)]);
    expect(nova).not.toBe(antes.receita_versao_id);
    const ainda = await como("admin", `select 1 from public.pedido_itens where receita_versao_id = $1`, [antes.receita_versao_id]);
    expect(ainda.length).toBeGreaterThan(0);
    await expect(como("outro", `select public.nova_versao_receita($1, 200, $2::jsonb)`, [receitaItaliana, JSON.stringify(ings)]))
      .rejects.toThrow(/Acesso negado/);
  });

  it("comprovantes no storage só são visíveis ao administrador (teste 10)", async () => {
    await dono.query(`insert into storage.objects (bucket_id, name) values ('comprovantes', 'solicitacoes/x/y.png')`);
    const [bucket] = (await dono.query(`select public from storage.buckets where id = 'comprovantes'`)).rows;
    expect(bucket.public).toBe(false);
    expect(await como("anon", `select * from storage.objects where bucket_id = 'comprovantes'`)).toHaveLength(0);
    expect(await como("outro", `select * from storage.objects where bucket_id = 'comprovantes'`)).toHaveLength(0);
    expect(await como("admin", `select * from storage.objects where bucket_id = 'comprovantes'`)).toHaveLength(1);
  });

  it("limita solicitações repetidas da mesma origem", async () => {
    const itens = [{ produto_id: prodNY, quantidade: 3 }];
    for (let i = 0; i < 8; i++) await criarSolicitacao(itens, "2026-10-12T15:00:00Z", { origem: "ip-abc" });
    await expect(criarSolicitacao(itens, "2026-10-12T15:10:00Z", { origem: "ip-abc" })).rejects.toThrow(/Muitas tentativas/);
  });

  it("campanha ativa não perde o último produto sem pausar", async () => {
    await expect(
      como("admin", `update public.campanha_produtos set ativo = false where campanha_id = $1`, [campanhaId]),
    ).rejects.toThrow(/Pause as vendas/);
  });
});
