"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { exigirAdmin } from "@/lib/auth";
import { mensagemDoBanco, type EstadoForm } from "@/lib/erros";

export interface ItemCompraForm {
  insumo_id: string;
  marca_id?: string;
  marca_nome?: string;
  usar_marca?: boolean;
  descricao_original?: string;
  pacotes: number;
  conteudo: number;
  unidade_conteudo: string;
  valor_linha_centavos: number;
}

export interface CompraForm {
  id?: string;
  versao?: number;
  fornecedor_id?: string;
  fornecedor_nome?: string;
  data: string;
  canal: string;
  minutos_trabalho: number;
  frete_centavos: number;
  servico_centavos: number;
  outras_centavos: number;
  desconto_centavos: number;
  observacoes?: string;
  ocr_texto?: string;
  ocr_total_centavos?: number | null;
  itens: ItemCompraForm[];
}

/** O banco recalcula rateio, totais e quantidades: o navegador só manda o que foi digitado. */
export async function salvarCompra(compra: CompraForm): Promise<{ erro?: string; id?: string }> {
  const { supabase } = await exigirAdmin();
  const { data, error } = await supabase.rpc("salvar_compra", { p: compra });
  if (error) return { erro: mensagemDoBanco(error) };
  revalidatePath("/admin/compras");
  revalidatePath("/admin/insumos", "layout");
  return { id: data as string };
}

export async function excluirCompra(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const motivo = String(d.get("motivo") ?? "").trim();
  if (!motivo) return { erro: "Informe o motivo da exclusão." };
  const { error } = await supabase.rpc("excluir_compra", { p_compra_id: String(d.get("id")), p_motivo: motivo });
  if (error) return { erro: mensagemDoBanco(error) };
  revalidatePath("/admin/compras");
  revalidatePath("/admin/insumos");
  redirect("/admin/compras?excluida=1");
}

export async function registrarAjuste(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const tipo = String(d.get("tipo"));
  const qtd = Number(String(d.get("quantidade") ?? "").replace(",", "."));
  if (!Number.isFinite(qtd) || qtd === 0) return { erro: "Informe a quantidade." };
  const quantidade = tipo === "perda" ? -Math.abs(qtd) : qtd;
  const [insumoId, marcaId] = String(d.get("insumo_marca") ?? "").split("|");
  if (!insumoId) return { erro: "Escolha o insumo e a marca." };
  const { error } = await supabase.rpc("registrar_ajuste_estoque", {
    p_marca_id: marcaId || null,
    p_categoria: tipo === "perda" ? String(d.get("categoria") ?? "outro") : null,
    p_insumo_id: insumoId,
    p_quantidade: quantidade,
    p_tipo: tipo,
    p_motivo: String(d.get("motivo") ?? ""),
    p_data: String(d.get("data") ?? "") || null,
  });
  if (error) return { erro: mensagemDoBanco(error) };
  revalidatePath("/admin/compras");
  revalidatePath("/admin/insumos", "layout");
  return { ok: tipo === "perda" ? "Perda registrada." : "Ajuste registrado." };
}

export async function salvarFornecedor(_: EstadoForm, d: FormData): Promise<EstadoForm> {
  const { supabase } = await exigirAdmin();
  const id = String(d.get("id") ?? "");
  const linha = {
    nome: String(d.get("nome") ?? "").trim(),
    contato: String(d.get("contato") ?? "").trim() || null,
    observacoes: String(d.get("observacoes") ?? "").trim() || null,
    ativo: id ? d.get("ativo") === "on" : true,
  };
  if (!linha.nome) return { erro: "Informe o nome." };
  const { error } = id
    ? await supabase.from("fornecedores").update(linha).eq("id", id)
    : await supabase.from("fornecedores").insert(linha);
  if (error) return { erro: error.code === "23505" ? "Já existe um fornecedor com esse nome." : mensagemDoBanco(error) };
  revalidatePath("/admin/compras");
  return { ok: id ? "Fornecedor salvo." : "Fornecedor cadastrado." };
}
