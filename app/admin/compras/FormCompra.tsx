"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatarBRL, lerBRL } from "@/lib/dinheiro";
import { hojeSP } from "@/lib/datas";
import { custoTempo, normalizarQuantidade, ratear } from "@/lib/rateio";
import { lerCupom, sugerirInsumo } from "@/lib/cupom";
import { sugerirMarca } from "@/lib/marcas";
import { salvarCompra, type CompraForm } from "./actions";

interface EmbalagemOpcao { id: string; nome: string; conteudo: number; unidade: string; marca_id?: string | null }
interface MarcaOpcao { id: string; nome: string; em_uso: boolean; ativo?: boolean }
interface Insumo { id: string; nome: string; unidade: string; embalagens?: EmbalagemOpcao[]; marcas?: MarcaOpcao[] }
interface Fornecedor { id: string; nome: string }

interface Linha {
  chave: string;
  insumo_id: string;
  descricao: string;
  pacotes: string;
  conteudo: string;
  unidade: string;
  valor: string;
  marca: string;      // id da marca, "" sem marca, "__nova" para digitar
  marcaNome: string;
  usarMarca: boolean;
  doCupom?: boolean;
}

export interface InicialCompra {
  id: string;
  versao: number;
  fornecedor_id: string;
  data: string;
  canal: string;
  minutos_trabalho: number;
  frete_centavos: number;
  servico_centavos: number;
  outras_centavos: number;
  desconto_centavos: number;
  observacoes: string | null;
  ocr_total_centavos: number | null;
  itens: { insumo_id: string; marca_id: string | null; descricao_original: string | null; pacotes: number; conteudo: number; unidade_conteudo: string; valor_linha_centavos: number }[];
}

const UNIDADES: Record<string, { v: string; r: string }[]> = {
  g: [{ v: "kg", r: "kg" }, { v: "g", r: "g" }],
  ml: [{ v: "l", r: "L" }, { v: "ml", r: "ml" }],
  un: [{ v: "un", r: "un" }],
};
const TODAS = [{ v: "kg", r: "kg" }, { v: "g", r: "g" }, { v: "l", r: "L" }, { v: "ml", r: "ml" }, { v: "un", r: "un" }];

const reais = (c: number) => (c / 100).toFixed(2).replace(".", ",");
const num = (t: string) => {
  const n = Number(String(t).replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};
let seq = 0;
const novaLinha = (p: Partial<Linha> = {}): Linha => ({ chave: `l${++seq}`, insumo_id: "", descricao: "", pacotes: "1", conteudo: "", unidade: "", valor: "", marca: "", marcaNome: "", usarMarca: false, ...p });
const marcaEmUso = (ins?: Insumo) => ins?.marcas?.find((m) => m.em_uso)?.id ?? "";

function compativel(unidadeInsumo: string | undefined, u: string) {
  if (!unidadeInsumo || !u) return false;
  return (UNIDADES[unidadeInsumo] ?? []).some((x) => x.v === u);
}

export function FormCompra({ insumos, fornecedores, valorHora, inicial }: {
  insumos: Insumo[]; fornecedores: Fornecedor[]; valorHora: number; inicial?: InicialCompra;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const [fornecedorId, setFornecedorId] = useState(inicial?.fornecedor_id ?? (fornecedores.length ? "" : "__novo"));
  const [fornecedorNome, setFornecedorNome] = useState("");
  const [data, setData] = useState(inicial?.data ?? hojeSP());
  const [canal, setCanal] = useState(inicial?.canal ?? "presencial");
  const [minutos, setMinutos] = useState(String(inicial?.minutos_trabalho ?? ""));
  const [frete, setFrete] = useState(inicial ? reais(inicial.frete_centavos) : "");
  const [servico, setServico] = useState(inicial ? reais(inicial.servico_centavos) : "");
  const [outras, setOutras] = useState(inicial ? reais(inicial.outras_centavos) : "");
  const [desconto, setDesconto] = useState(inicial ? reais(inicial.desconto_centavos) : "");
  const [observacoes, setObservacoes] = useState(inicial?.observacoes ?? "");
  const [linhas, setLinhas] = useState<Linha[]>(
    inicial?.itens.length
      ? inicial.itens.map((i) => novaLinha({
          insumo_id: i.insumo_id, marca: i.marca_id ?? "", descricao: i.descricao_original ?? "", pacotes: String(i.pacotes).replace(".", ","),
          conteudo: String(i.conteudo).replace(".", ","), unidade: i.unidade_conteudo, valor: reais(i.valor_linha_centavos),
        }))
      : [novaLinha()],
  );

  // Leitura do cupom
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [ocr, setOcr] = useState<{ estado: "livre" | "lendo" | "ok" | "erro"; progresso: number; msg?: string }>({ estado: "livre", progresso: 0 });
  const [ocrTexto, setOcrTexto] = useState("");
  const [ocrTotal, setOcrTotal] = useState<number | null>(inicial?.ocr_total_centavos ?? null);

  const insumo = (id: string) => insumos.find((i) => i.id === id);
  const set = (k: number, p: Partial<Linha>) => setLinhas((ls) => ls.map((l, i) => (i === k ? { ...l, ...p } : l)));

  async function lerFoto(arquivo: File) {
    setOcr({ estado: "lendo", progresso: 0 });
    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("por", 1, {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === "recognizing text") setOcr({ estado: "lendo", progresso: m.progress });
        },
      });
      const { data: res } = await worker.recognize(arquivo);
      await worker.terminate();
      const leitura = lerCupom(res.text);
      setOcrTexto(res.text);
      setOcrTotal(leitura.totalCentavos ?? null);
      if (leitura.data) setData(leitura.data);
      if (leitura.fornecedor && !inicial) {
        const chave = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        const lido = chave(leitura.fornecedor);
        const existente = fornecedores.find((f) => { const n = chave(f.nome); return n.length >= 3 && (lido.includes(n) || n.includes(lido)); });
        if (existente) setFornecedorId(existente.id);
        else { setFornecedorId("__novo"); setFornecedorNome(leitura.fornecedor); }
      }
      if (!leitura.itens.length) {
        setOcr({ estado: "erro", progresso: 1, msg: "Não reconheci itens nesta foto. Tente uma foto mais nítida e reta, ou lance os itens à mão." });
        return;
      }
      const novas = leitura.itens.map((it) => {
        const s = sugerirInsumo(it.descricao, insumos);
        const ins = s ? insumos.find((x) => x.id === s.id) : undefined;
        const m = ins?.marcas?.length ? sugerirMarca(it.descricao, ins.marcas.filter((x) => x.ativo !== false)) : null;
        return novaLinha({
          doCupom: true,
          insumo_id: s?.id ?? "",
          marca: m?.id ?? marcaEmUso(ins),
          descricao: it.descricao,
          pacotes: it.pacotes ? String(it.pacotes) : "",
          conteudo: it.conteudo != null ? String(it.conteudo).replace(".", ",") : "",
          unidade: it.unidade && (!s || compativel(s.unidade, it.unidade)) ? it.unidade : "",
          valor: it.valorCentavos != null ? reais(it.valorCentavos) : "",
        });
      });
      setLinhas((ls) => [...ls.filter((l) => l.insumo_id || l.valor || l.descricao), ...novas]);
      setOcr({ estado: "ok", progresso: 1, msg: `${novas.length} ${novas.length === 1 ? "item lido" : "itens lidos"}. Revise cada linha: campos em destaque não foram reconhecidos.` });
    } catch {
      setOcr({ estado: "erro", progresso: 0, msg: "Não foi possível ler a foto agora. O lançamento manual continua funcionando." });
    } finally {
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  }

  // Prévia (o banco recalcula tudo ao salvar)
  const previa = useMemo(() => {
    const vals = linhas.map((l) => lerBRL(l.valor) ?? 0);
    const extras = (lerBRL(frete) ?? 0) + (lerBRL(servico) ?? 0) + (lerBRL(outras) ?? 0) - (lerBRL(desconto) ?? 0);
    const subtotal = vals.reduce((a, b) => a + b, 0);
    let finais: number[] | null = null;
    let aviso: string | null = null;
    try {
      if (subtotal + extras < 0) aviso = "O desconto é maior que o valor da compra.";
      else if (subtotal === 0 && extras !== 0) aviso = "Informe os valores dos itens para ratear frete e taxas.";
      else finais = ratear(vals, extras);
    } catch {
      aviso = "Confira os valores.";
    }
    const quantidades = linhas.map((l) => {
      const p = num(l.pacotes), c = num(l.conteudo);
      if (!(p > 0) || !(c > 0) || !l.unidade) return null;
      try { return normalizarQuantidade(p, c, l.unidade); } catch { return null; }
    });
    return { vals, extras, subtotal, total: subtotal + extras, finais, aviso, quantidades };
  }, [linhas, frete, servico, outras, desconto]);

  const tempo = custoTempo(Number(minutos) || 0, valorHora);

  function enviar() {
    setErro(null);
    if (fornecedorId === "" ) return setErro("Escolha o fornecedor ou cadastre um novo.");
    for (const [k, l] of linhas.entries()) {
      if (!l.insumo_id) return setErro(`Linha ${k + 1}: escolha o insumo ou remova a linha (itens pessoais não entram).`);
      if (!(num(l.pacotes) > 0) || !(num(l.conteudo) > 0) || !l.unidade) return setErro(`Linha ${k + 1}: informe pacotes, conteúdo e unidade da embalagem.`);
      if (lerBRL(l.valor) == null) return setErro(`Linha ${k + 1}: informe o valor da linha.`);
      if (l.marca === "__nova" && !l.marcaNome.trim()) return setErro(`Linha ${k + 1}: digite o nome da nova marca ou escolha uma da lista.`);
    }
    const payload: CompraForm = {
      id: inicial?.id,
      versao: inicial?.versao,
      fornecedor_id: fornecedorId !== "__novo" ? fornecedorId : undefined,
      fornecedor_nome: fornecedorId === "__novo" ? fornecedorNome : undefined,
      data, canal,
      minutos_trabalho: Number(minutos) || 0,
      frete_centavos: lerBRL(frete) ?? 0,
      servico_centavos: lerBRL(servico) ?? 0,
      outras_centavos: lerBRL(outras) ?? 0,
      desconto_centavos: lerBRL(desconto) ?? 0,
      observacoes,
      ocr_texto: ocrTexto || undefined,
      ocr_total_centavos: ocrTotal,
      itens: linhas.map((l) => ({
        insumo_id: l.insumo_id,
        marca_id: l.marca && l.marca !== "__nova" ? l.marca : undefined,
        marca_nome: l.marca === "__nova" ? l.marcaNome.trim() : undefined,
        usar_marca: l.usarMarca || undefined,
        descricao_original: l.descricao,
        pacotes: num(l.pacotes),
        conteudo: num(l.conteudo),
        unidade_conteudo: l.unidade,
        valor_linha_centavos: lerBRL(l.valor) ?? 0,
      })),
    };
    iniciar(async () => {
      const r = await salvarCompra(payload);
      if (r.erro) setErro(r.erro);
      else router.push(`/admin/compras/${r.id}?salva=1`);
    });
  }

  const destaque = { borderColor: "var(--alerta)", background: "var(--alerta-bg)" };

  return (
    <div>
      {!inicial && (
        <div className="cartao">
          <h2>Foto do cupom (opcional)</h2>
          <p className="suave">A leitura acontece no seu aparelho e gera um rascunho para você revisar. Nada é salvo sem a sua revisão.</p>
          <div className="acoes">
            <input ref={arquivoRef} type="file" accept="image/*" capture="environment" disabled={ocr.estado === "lendo"}
              onChange={(e) => e.target.files?.[0] && lerFoto(e.target.files[0])} aria-label="Foto do cupom" />
          </div>
          {ocr.estado === "lendo" && (
            <div className="aviso info" style={{ marginTop: "0.75rem" }}>
              Lendo o cupom… {Math.round(ocr.progresso * 100)}%
              <div style={{ height: 6, background: "var(--creme-2)", borderRadius: 3, marginTop: 6 }}>
                <div style={{ height: 6, width: `${Math.round(ocr.progresso * 100)}%`, background: "var(--verde)", borderRadius: 3 }} />
              </div>
            </div>
          )}
          {ocr.estado === "ok" && <div className="aviso ok" style={{ marginTop: "0.75rem", marginBottom: 0 }}>{ocr.msg}</div>}
          {ocr.estado === "erro" && <div className="aviso erro" style={{ marginTop: "0.75rem", marginBottom: 0 }}>{ocr.msg}</div>}
        </div>
      )}

      <div className="cartao">
        <h2>Compra</h2>
        <div className="grade">
          <div className="campo">
            <label htmlFor="fornecedor">Fornecedor</label>
            <select id="fornecedor" value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)}>
              <option value="" disabled>Escolha…</option>
              {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
              <option value="__novo">+ Cadastrar novo</option>
            </select>
          </div>
          {fornecedorId === "__novo" && (
            <div className="campo">
              <label htmlFor="fornecedor_nome">Nome do novo fornecedor</label>
              <input id="fornecedor_nome" value={fornecedorNome} onChange={(e) => setFornecedorNome(e.target.value)} />
            </div>
          )}
          <div className="campo">
            <label htmlFor="data">Data</label>
            <input id="data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
          <div className="campo">
            <label htmlFor="canal">Canal</label>
            <select id="canal" value={canal} onChange={(e) => setCanal(e.target.value)}>
              <option value="presencial">Presencial</option>
              <option value="online">Online</option>
            </select>
          </div>
        </div>
      </div>

      <div className="cartao">
        <h2>Itens</h2>
        <p className="suave" style={{ fontSize: "0.9rem" }}>
          Informe quantos pacotes, o conteúdo de cada um e o valor total da linha. Itens pessoais: remova a linha.
        </p>
        {linhas.map((l, k) => {
          const ins = insumo(l.insumo_id);
          const opcoes = ins ? UNIDADES[ins.unidade] : TODAS;
          const unidadeRuim = !!l.unidade && !!ins && !compativel(ins.unidade, l.unidade);
          const q = previa.quantidades[k];
          return (
            <div key={l.chave} style={{ borderTop: k ? "1px solid var(--creme-2)" : 0, paddingTop: k ? "0.9rem" : 0, marginTop: k ? "0.9rem" : 0 }}>
              {l.descricao && l.doCupom && <div className="caixa-alta suave" style={{ marginBottom: "0.3rem" }}>No cupom: {l.descricao}</div>}
              <div className="grade" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
                <div className="campo" style={{ gridColumn: "span 2" }}>
                  <label htmlFor={`ins-${l.chave}`}>Insumo</label>
                  <select id={`ins-${l.chave}`} value={l.insumo_id} style={!l.insumo_id ? destaque : undefined}
                    onChange={(e) => {
                      const novo = insumo(e.target.value);
                      set(k, { insumo_id: e.target.value, marca: marcaEmUso(novo), marcaNome: "", usarMarca: false,
                        unidade: novo && compativel(novo.unidade, l.unidade) ? l.unidade : novo?.unidade === "un" ? "un" : "" });
                    }}>
                    <option value="">Escolha…</option>
                    {insumos.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
                  </select>
                </div>
                {ins && (
                  <div className="campo" style={{ gridColumn: "span 2" }}>
                    <label htmlFor={`m-${l.chave}`}>Marca</label>
                    <select id={`m-${l.chave}`} value={l.marca} onChange={(e) => set(k, { marca: e.target.value, usarMarca: false })}>
                      <option value="">Sem marca</option>
                      {(ins.marcas ?? []).filter((m) => m.ativo !== false || m.id === l.marca).map((m) => <option key={m.id} value={m.id}>{m.nome}{m.em_uso ? " (em uso)" : ""}</option>)}
                      <option value="__nova">+ Nova marca</option>
                    </select>
                  </div>
                )}
                {ins && l.marca === "__nova" && (
                  <div className="campo" style={{ gridColumn: "span 2" }}>
                    <label htmlFor={`mn-${l.chave}`}>Nome da nova marca</label>
                    <input id={`mn-${l.chave}`} value={l.marcaNome} maxLength={80} placeholder="Ex.: Caputo Pizzeria" style={!l.marcaNome.trim() ? destaque : undefined}
                      onChange={(e) => set(k, { marcaNome: e.target.value })} />
                  </div>
                )}
                {!!ins?.embalagens?.length && (
                  <div className="campo" style={{ gridColumn: "span 2" }}>
                    <label htmlFor={`e-${l.chave}`}>Embalagem</label>
                    <select id={`e-${l.chave}`}
                      value={ins.embalagens.find((e) => e.unidade === l.unidade && Number(e.conteudo) === num(l.conteudo) && (e.marca_id ?? "") === (l.marca === "__nova" ? "" : l.marca))?.id
                        ?? ins.embalagens.find((e) => e.unidade === l.unidade && Number(e.conteudo) === num(l.conteudo) && !e.marca_id)?.id ?? ""}
                      onChange={(ev) => {
                        const emb = ins.embalagens!.find((e) => e.id === ev.target.value);
                        if (emb) set(k, { conteudo: String(emb.conteudo).replace(".", ","), unidade: emb.unidade, ...(emb.marca_id ? { marca: emb.marca_id, usarMarca: false } : {}) });
                      }}>
                      <option value="">Outra (digitar)</option>
                      {ins.embalagens.map((e) => {
                        const m = ins.marcas?.find((x) => x.id === e.marca_id);
                        return <option key={e.id} value={e.id}>{m ? `${m.nome} · ${e.nome}` : e.nome}</option>;
                      })}
                    </select>
                  </div>
                )}
                <div className="campo">
                  <label htmlFor={`p-${l.chave}`}>Pacotes</label>
                  <input id={`p-${l.chave}`} inputMode="decimal" value={l.pacotes} style={!(num(l.pacotes) > 0) ? destaque : undefined}
                    onChange={(e) => set(k, { pacotes: e.target.value })} />
                </div>
                <div className="campo">
                  <label htmlFor={`c-${l.chave}`}>Conteúdo de cada</label>
                  <input id={`c-${l.chave}`} inputMode="decimal" value={l.conteudo} placeholder="ex.: 1" style={!(num(l.conteudo) > 0) ? destaque : undefined}
                    onChange={(e) => set(k, { conteudo: e.target.value })} />
                </div>
                <div className="campo">
                  <label htmlFor={`u-${l.chave}`}>Unidade</label>
                  <select id={`u-${l.chave}`} value={l.unidade} style={!l.unidade || unidadeRuim ? destaque : undefined}
                    onChange={(e) => set(k, { unidade: e.target.value })}>
                    <option value="">—</option>
                    {opcoes.map((u) => <option key={u.v} value={u.v}>{u.r}</option>)}
                  </select>
                </div>
                <div className="campo">
                  <label htmlFor={`v-${l.chave}`}>Valor da linha (R$)</label>
                  <input id={`v-${l.chave}`} inputMode="decimal" value={l.valor} placeholder="0,00" style={lerBRL(l.valor) == null ? destaque : undefined}
                    onChange={(e) => set(k, { valor: e.target.value })} />
                </div>
              </div>
              <div className="acoes" style={{ justifyContent: "space-between", fontSize: "0.88rem" }}>
                <span className="suave">
                  {q ? <>Entra no estoque: <strong>{q.quantidade.toLocaleString("pt-BR")} {q.unidade}</strong></> : "Complete a embalagem para ver a quantidade"}
                  {previa.finais && <> · custo final <strong>{formatarBRL(previa.finais[k])}</strong></>}
                  {unidadeRuim && <span style={{ color: "var(--erro)" }}> · unidade incompatível com o insumo</span>}
                </span>
                {ins && l.marca && l.marca !== marcaEmUso(ins) && (
                  <label className="check" style={{ fontSize: "0.88rem" }}>
                    <input type="checkbox" checked={l.usarMarca} onChange={(e) => set(k, { usarMarca: e.target.checked })} />
                    Usar esta marca nos próximos lotes{marcaEmUso(ins) ? ` (hoje: ${ins.marcas?.find((m) => m.em_uso)?.nome})` : ""}
                  </label>
                )}
                <button type="button" className="contorno pequeno" onClick={() => setLinhas((ls) => ls.length > 1 ? ls.filter((_, i) => i !== k) : [novaLinha()])}>Remover</button>
              </div>
            </div>
          );
        })}
        <div style={{ marginTop: "0.9rem" }}>
          <button type="button" className="contorno pequeno" onClick={() => setLinhas((ls) => [...ls, novaLinha()])}>Adicionar item</button>
        </div>
      </div>

      <div className="cartao">
        <h2>Frete, taxas e tempo</h2>
        <p className="suave" style={{ fontSize: "0.9rem" }}>Se a nota tiver itens pessoais, informe só a parte das taxas que é do negócio.</p>
        <div className="grade">
          <div className="campo"><label htmlFor="frete">Frete (R$)</label><input id="frete" inputMode="decimal" value={frete} onChange={(e) => setFrete(e.target.value)} placeholder="0,00" /></div>
          <div className="campo"><label htmlFor="servico">Taxa de serviço (R$)</label><input id="servico" inputMode="decimal" value={servico} onChange={(e) => setServico(e.target.value)} placeholder="0,00" /></div>
          <div className="campo"><label htmlFor="outras">Outras despesas (R$)</label><input id="outras" inputMode="decimal" value={outras} onChange={(e) => setOutras(e.target.value)} placeholder="0,00" /></div>
          <div className="campo"><label htmlFor="desconto">Desconto geral (R$)</label><input id="desconto" inputMode="decimal" value={desconto} onChange={(e) => setDesconto(e.target.value)} placeholder="0,00" /></div>
        </div>
        <div className="grade">
          <div className="campo">
            <label htmlFor="minutos">Tempo gasto na compra (minutos)</label>
            <input id="minutos" type="number" min={0} max={1440} value={minutos} onChange={(e) => setMinutos(e.target.value)} placeholder="0" />
            <span className="ajuda">Conta uma vez por compra, separado do estoque: {formatarBRL(tempo)} {inicial ? "(valor da hora da época)" : `(hora a ${formatarBRL(valorHora)})`}.</span>
          </div>
          <div className="campo">
            <label htmlFor="obs">Observações</label>
            <input id="obs" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="cartao">
        <h2>Resumo</h2>
        <div className="linha-total"><span>Soma dos itens</span><span className="num">{formatarBRL(previa.subtotal)}</span></div>
        <div className="linha-total"><span>Frete, taxas e desconto (rateados)</span><span className="num">{formatarBRL(previa.extras)}</span></div>
        <div className="linha-total forte"><span>Total da compra</span><span className="num">{formatarBRL(previa.total)}</span></div>
        {ocrTotal != null && (
          <div className={`aviso ${ocrTotal === previa.subtotal || ocrTotal === previa.total ? "ok" : "alerta"}`} style={{ marginTop: "0.75rem", marginBottom: 0 }}>
            Total lido no cupom: <strong>{formatarBRL(ocrTotal)}</strong>.{" "}
            {ocrTotal === previa.subtotal || ocrTotal === previa.total ? "Confere com os itens." : `Diferença de ${formatarBRL(Math.abs(ocrTotal - previa.subtotal))} para a soma dos itens. Confira se faltou ou sobrou algum item.`}
          </div>
        )}
        {previa.aviso && <div className="aviso erro" style={{ marginTop: "0.75rem", marginBottom: 0 }}>{previa.aviso}</div>}
      </div>

      {erro && <div className="aviso erro" role="alert">{erro}</div>}
      <button type="button" className="bordo" onClick={enviar} disabled={pendente}>
        {pendente ? "Salvando…" : inicial ? "Salvar alterações" : "Salvar compra"}
      </button>
      {inicial && <p className="suave" style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>Ao salvar, a entrada antiga no estoque é estornada e a nova é lançada. Nada é duplicado.</p>}
    </div>
  );
}
