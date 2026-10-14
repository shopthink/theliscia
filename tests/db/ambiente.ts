/** Banco temporário com o stub do Supabase e todas as migrações, para testes de integração. */
import { Client } from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const HOST = process.env.TEST_PGHOST;
export const PORT = Number(process.env.TEST_PGPORT ?? 5432);
export const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
export const OUTRO_ID = "00000000-0000-4000-8000-000000000002";
const ROOT = join(__dirname, "..", "..");

export type Papel = "anon" | "outro" | "admin" | "servico";

export async function criarAmbiente(prefixo: string) {
  const nome = `${prefixo}_${Date.now()}`;
  const sup = new Client({ host: HOST, port: PORT, user: "postgres", database: "postgres" });
  await sup.connect();
  await sup.query(`create database ${nome}`);
  await sup.end();

  const conexoes: Client[] = [];
  const conectar = async (user: string) => {
    const c = new Client({ host: HOST, port: PORT, user, database: nome });
    await c.connect();
    conexoes.push(c);
    return c;
  };
  const dono = await conectar("postgres");
  await dono.query(readFileSync(join(ROOT, "tests/db/supabase-stub.sql"), "utf8"));
  const dir = join(ROOT, "supabase/migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await dono.query("begin");
    await dono.query(readFileSync(join(dir, f), "utf8"));
    await dono.query("commit");
  }
  await dono.query(`insert into auth.users (id, email) values ($1, 'dono@x'), ($2, 'outro@x')`, [ADMIN_ID, OUTRO_ID]);
  await dono.query(`insert into public.admins (user_id) values ($1)`, [ADMIN_ID]);

  async function como<T = any>(papel: Papel, sql: string, params: unknown[] = []): Promise<T[]> {
    const cli = await conectar("authenticator");
    const claims =
      papel === "admin" ? { sub: ADMIN_ID, role: "authenticated" }
      : papel === "outro" ? { sub: OUTRO_ID, role: "authenticated" }
      : papel === "servico" ? { role: "service_role" } : { role: "anon" };
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
      await cli.end();
    }
  }

  async function encerrar() {
    for (const c of conexoes) await c.end().catch(() => {});
    const s = new Client({ host: HOST, port: PORT, user: "postgres", database: "postgres" });
    await s.connect();
    await s.query(`drop database if exists ${nome} with (force)`);
    await s.end();
  }

  return { dono, como, encerrar };
}
