import { NextResponse, type NextRequest } from "next/server";
import { clienteDaSessao } from "@/lib/supabase/servidor";
import { formatarData, hojeSP } from "@/lib/datas";
import { formatarTelefone } from "@/lib/telefone";
import { gerarCSV, ORIGENS, SEGMENTOS } from "@/lib/crm";
import { consultarClientes } from "@/lib/crmConsulta";

export const dynamic = "force-dynamic";

/** Planilha dos clientes filtrados. Só o administrador (RLS da view garante). */
export async function GET(req: NextRequest) {
  const sb = await clienteDaSessao();
  const { data: admin } = await sb.rpc("is_admin");
  if (admin !== true) return new NextResponse("Acesso negado.", { status: 403 });
  const p = req.nextUrl.searchParams;
  const { data } = await consultarClientes(sb, {
    seg: p.get("seg") ?? undefined, q: p.get("q") ?? undefined, novidades: p.get("novidades") ?? undefined,
    cond: p.get("cond") ?? undefined, etiqueta: p.get("etiqueta") ?? undefined,
  }, 10000);
  const dia = (ts: string | null) => (ts ? formatarData(hojeSP(new Date(ts))) : "");
  const csv = gerarCSV(
    ["Nome", "WhatsApp", "Telefone (só números)", "Segmento", "Fã", "Aceita novidades", "Condomínio", "Bloco", "Apto", "Pedidos", "Bases", "Total (R$)", "Primeiro pedido", "Último pedido", "Origem", "Etiquetas"],
    (data ?? []).map((c: any) => [
      c.nome, formatarTelefone(c.telefone), `55${c.telefone}`, SEGMENTOS[c.segmento]?.rotulo ?? c.segmento, c.fa ? "sim" : "",
      c.aceita_novidades ? "sim" : "não", c.condominio_nome, c.bloco, c.apto, c.pedidos, c.bases,
      (Number(c.total_centavos) / 100).toFixed(2).replace(".", ","), dia(c.primeiro_pedido_em), dia(c.ultimo_pedido_em),
      ORIGENS[c.origem] ?? c.origem, (c.etiquetas ?? []).join(", "),
    ]),
  );
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="clientes-${hojeSP()}.csv"`,
      "cache-control": "no-store",
    },
  });
}
