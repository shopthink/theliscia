"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatarBRL } from "@/lib/dinheiro";
import { formatarData, formatarDataHora, formatarHora, isoParaLocalSP } from "@/lib/datas";
import { ESPERAS, ESPERAS_BASE, ESPERAS_PREPARO, ETAPAS_BASE, ETAPAS_PREPARO, ETAPAS_TRABALHO, codigoLote, minutosAtivos, type Sessao } from "@/lib/producao";
import { Regressiva, Relogio, TotalTrabalho, duracao } from "../Relogio";
import {
  cancelarLote, concluirLote, encerrarEspera, excluirSessao, iniciarEspera, iniciarEtapa, marcarLembrete, pausar,
  registrarSessao, salvarApontamento,
} from "../actions";

interface Lote {
  id: string; numero: number; tipo: "base" | "preparo"; status: string; versao: number;
  unidades_boas: number | null; perdas: number; quantidade_produzida: number | null; observacoes: string | null;
  produzido_em: string | null; assado_em: string | null; congelado_em: string | null; bases_pedidos: number; unidadeProduto: string | null;
}
interface Espera { id: string; tipo: string; inicio: string; fim: string | null; alvo_min: number; lembrete_min: number | null; lembrete_feito_em: string | null }
interface Consumo { insumo_id: string; nome: string; unidade: string; prevista: number; real: number; custoUnit: number | null; custoTotal: number | null }

const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

export function PainelLote({ lote, sessoes, esperas, consumos, insumos, estoque, abertaOutra }: {
  lote: Lote; sessoes: Sessao[]; esperas: Espera[]; consumos: Consumo[];
  insumos: { id: string; nome: string; unidade: string }[]; estoque: Record<string, number>;
  abertaOutra: { etapa: string; numero: number; lote_id: string } | null;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const editavel = lote.status === "planejado" || lote.status === "em_producao";
  const aberta = sessoes.find((s) => !s.fim) ?? null;
  const esperaAtiva = esperas.find((e) => !e.fim) ?? null;
  const etapas = lote.tipo === "base" ? ETAPAS_BASE : ETAPAS_PREPARO;
  const tiposEspera = lote.tipo === "base" ? ESPERAS_BASE : ESPERAS_PREPARO;
  const fechados = minutosAtivos(sessoes.filter((s) => s.fim));

  const agir = (fn: () => Promise<{ erro?: string; ok?: string }>) => {
    setErro(null);
    setOk(null);
    iniciar(async () => {
      const r = await fn();
      if (r?.erro) setErro(r.erro);
      else {
        if (r?.ok) setOk(r.ok);
        router.refresh();
      }
    });
  };

  // Mantém a tela acesa enquanto o cronômetro roda (celular na cozinha)
  useEffect(() => {
    if (!aberta) return;
    let trava: { release: () => Promise<void> } | null = null;
    (navigator as any).wakeLock?.request("screen").then((t: any) => (trava = t)).catch(() => {});
    return () => { trava?.release().catch(() => {}); };
  }, [aberta]);

  const [podeAvisar, setPodeAvisar] = useState(false);
  useEffect(() => { setPodeAvisar(typeof Notification !== "undefined" && Notification.permission === "default"); }, []);

  // Aviso da dobra
  const avisado = useRef(false);
  const [horaDaDobra, setHoraDaDobra] = useState(false);
  useEffect(() => {
    const e = esperaAtiva;
    if (!e?.lembrete_min || e.lembrete_feito_em) { setHoraDaDobra(false); return; }
    const alvo = Date.parse(e.inicio) + e.lembrete_min * 60000;
    const checar = () => {
      const chegou = Date.now() >= alvo;
      setHoraDaDobra(chegou);
      if (chegou && !avisado.current) {
        avisado.current = true;
        try { navigator.vibrate?.([300, 150, 300]); } catch {}
        try { if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("The Liscia", { body: `Hora da dobra no lote ${codigoLote(lote.numero)}` }); } catch {}
      }
    };
    checar();
    const t = setInterval(checar, 10000);
    return () => clearInterval(t);
  }, [esperaAtiva, lote.numero]);

  return (
    <>
      {erro && <div className="aviso erro" role="alert">{erro}</div>}
      {ok && <div className="aviso ok" role="status">{ok}</div>}

      {editavel && (
        <div className="cartao cronometro">
          {aberta ? (
            <div className="rodando">
              <div className="caixa-alta" style={{ opacity: 0.8 }}>Trabalhando em</div>
              <div className="etapa-atual">{ETAPAS_TRABALHO[aberta.etapa]}</div>
              <div className="tempo num"><Relogio desde={aberta.inicio} /></div>
              <button type="button" className="botao-grande pausar" disabled={pendente} onClick={() => agir(() => pausar(lote.id))}>⏸ Pausar</button>
              <div className="trocar">
                <span>Trocar para:</span>
                {etapas.filter((e) => e !== aberta.etapa).map((e) => (
                  <button key={e} type="button" className="contorno pequeno" disabled={pendente} onClick={() => agir(() => iniciarEtapa(lote.id, e))}>▶ {ETAPAS_TRABALHO[e]}</button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="acoes" style={{ justifyContent: "space-between", marginBottom: "0.75rem" }}>
                <h2 style={{ margin: 0 }}>Começar a trabalhar</h2>
                {abertaOutra && <span className="selo alerta">Rodando: {ETAPAS_TRABALHO[abertaOutra.etapa]} no {codigoLote(abertaOutra.numero)} (dar play aqui pausa lá)</span>}
              </div>
              <div className="grade-etapas">
                {etapas.map((e) => (
                  <button key={e} type="button" className="botao-grande" disabled={pendente} onClick={() => agir(() => iniciarEtapa(lote.id, e))}>▶ {ETAPAS_TRABALHO[e]}</button>
                ))}
              </div>
            </>
          )}
          <div className="linha-total" style={{ marginTop: "0.9rem" }}>
            <span>Trabalho ativo no lote</span>
            <strong className="num"><TotalTrabalho minutosFechados={fechados} abertaDesde={aberta?.inicio} /></strong>
          </div>
        </div>
      )}

      {editavel && (
        <div className="cartao">
          <h2>Esperas</h2>
          <p className="suave" style={{ fontSize: "0.9rem" }}>Descanso, geladeira e freezer não contam como trabalho. Começar uma espera pausa o cronômetro.</p>
          {esperaAtiva && (
            <div className="espera-ativa">
              <div>
                <div className="caixa-alta suave">⏳ {ESPERAS[esperaAtiva.tipo]} desde {formatarHora(esperaAtiva.inicio)}</div>
                <div style={{ fontSize: "1.3rem", fontWeight: 600 }}><Regressiva desde={esperaAtiva.inicio} alvoMin={esperaAtiva.alvo_min} /></div>
                <div className="suave" style={{ fontSize: "0.85rem" }}>Pronto às {formatarDataHora(new Date(Date.parse(esperaAtiva.inicio) + esperaAtiva.alvo_min * 60000).toISOString())}</div>
                {esperaAtiva.lembrete_min != null && (
                  esperaAtiva.lembrete_feito_em
                    ? <div className="selo ok" style={{ marginTop: 6 }}>Dobra feita às {formatarHora(esperaAtiva.lembrete_feito_em)}</div>
                    : horaDaDobra
                      ? <div className="aviso alerta" style={{ margin: "0.5rem 0 0" }}><strong>Hora da dobra!</strong>{" "}
                          <button type="button" className="pequeno" disabled={pendente} onClick={() => agir(() => marcarLembrete(lote.id, esperaAtiva.id))}>Dobra feita</button></div>
                      : <div className="suave" style={{ marginTop: 6 }}>Dobra: <Regressiva desde={esperaAtiva.inicio} alvoMin={esperaAtiva.lembrete_min} /></div>
                )}
              </div>
              <button type="button" className="contorno" disabled={pendente} onClick={() => agir(() => encerrarEspera(lote.id, esperaAtiva.id))}>Encerrar espera</button>
            </div>
          )}
          <div className="acoes">
            {tiposEspera.map((t) => (
              <button key={t} type="button" className="contorno" disabled={pendente} onClick={() => agir(() => iniciarEspera(lote.id, t))}>⏳ {ESPERAS[t]}</button>
            ))}
            {podeAvisar && (
              <button type="button" className="contorno pequeno" onClick={() => Notification.requestPermission().then(() => setPodeAvisar(false))}>Ativar avisos</button>
            )}
          </div>
        </div>
      )}

      <LinhaDoTempo lote={lote} sessoes={sessoes} esperas={esperas} editavel={editavel} etapas={etapas} agir={agir} pendente={pendente} />

      <div className="cartao">
        <h2>Datas para a etiqueta</h2>
        <div className="linha-total"><span>Produção (primeira massa/preparo)</span><strong>{formatarData(lote.produzido_em)}</strong></div>
        {lote.tipo === "base" && <div className="linha-total"><span>Assada (primeiro forno)</span><strong>{formatarData(lote.assado_em)}</strong></div>}
        <div className="linha-total"><span>Congelada (entrada no freezer)</span><strong>{formatarData(lote.congelado_em)}</strong></div>
      </div>

      <Apontamento lote={lote} consumos={consumos} insumos={insumos} estoque={estoque} editavel={editavel} agir={agir} pendente={pendente} temAberta={!!aberta} />
    </>
  );
}

function LinhaDoTempo({ lote, sessoes, esperas, editavel, etapas, agir, pendente }: {
  lote: Lote; sessoes: Sessao[]; esperas: Espera[]; editavel: boolean; etapas: string[];
  agir: (fn: () => Promise<{ erro?: string; ok?: string }>) => void; pendente: boolean;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const eventos = useMemo(() => [
    ...sessoes.map((s) => ({ tipo: "sessao" as const, inicio: s.inicio, s })),
    ...esperas.map((e) => ({ tipo: "espera" as const, inicio: e.inicio, e })),
  ].sort((a, b) => a.inicio.localeCompare(b.inicio)), [sessoes, esperas]);

  return (
    <div className="cartao">
      <div className="acoes" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Linha do tempo</h2>
        {editavel && <button type="button" className="contorno pequeno" onClick={() => setNovo((v) => !v)}>{novo ? "Fechar" : "Lançar sessão à mão"}</button>}
      </div>
      {novo && editavel && (
        <FormSessao etapas={etapas} onSalvar={(etapa, ini, fim) => { agir(() => registrarSessao(lote.id, etapa, ini, fim)); setNovo(false); }} pendente={pendente} />
      )}
      {!eventos.length ? <div className="vazio">Nada registrado ainda.</div> : (
        <div className="tabela-rolagem" style={{ marginTop: "0.6rem" }}>
          <table>
            <thead><tr><th>Etapa</th><th>Início</th><th>Fim</th><th className="dir">Duração</th><th></th></tr></thead>
            <tbody>
              {eventos.map((ev) => ev.tipo === "sessao" ? (
                editando === ev.s.id ? (
                  <tr key={ev.s.id}><td colSpan={5}>
                    <FormSessao etapas={etapas} inicial={ev.s} pendente={pendente}
                      onSalvar={(etapa, ini, fim) => { agir(() => registrarSessao(lote.id, etapa, ini, fim, ev.s.id)); setEditando(null); }}
                      onCancelar={() => setEditando(null)} />
                  </td></tr>
                ) : (
                  <tr key={ev.s.id}>
                    <td><strong>{ETAPAS_TRABALHO[ev.s.etapa]}</strong>{ev.s.manual && <span className="suave" style={{ fontSize: "0.75rem" }}> · à mão</span>}</td>
                    <td className="num">{formatarDataHora(ev.s.inicio)}</td>
                    <td className="num">{ev.s.fim ? formatarHora(ev.s.fim) : <span className="selo alerta">rodando</span>}</td>
                    <td className="dir num">{ev.s.fim ? duracao(Date.parse(ev.s.fim) - Date.parse(ev.s.inicio)) : <Relogio desde={ev.s.inicio} />}</td>
                    <td className="dir">
                      {editavel && ev.s.fim && (
                        <span className="acoes" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                          <button type="button" className="contorno pequeno" onClick={() => setEditando(ev.s.id)}>Corrigir</button>
                          <button type="button" className="contorno pequeno" disabled={pendente}
                            onClick={() => { if (confirm("Apagar esta sessão?")) agir(() => excluirSessao(lote.id, ev.s.id)); }}>×</button>
                        </span>
                      )}
                    </td>
                  </tr>
                )
              ) : (
                <tr key={ev.e.id} style={{ color: "var(--suave)" }}>
                  <td>⏳ {ESPERAS[ev.e.tipo]} <span style={{ fontSize: "0.75rem" }}>(não conta)</span></td>
                  <td className="num">{formatarDataHora(ev.e.inicio)}</td>
                  <td className="num">{ev.e.fim ? formatarDataHora(ev.e.fim) : <span className="selo">em andamento</span>}</td>
                  <td className="dir num">{ev.e.fim ? duracao(Date.parse(ev.e.fim) - Date.parse(ev.e.inicio)) : <Relogio desde={ev.e.inicio} />}</td>
                  <td></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FormSessao({ etapas, inicial, onSalvar, onCancelar, pendente }: {
  etapas: string[]; inicial?: Sessao; pendente: boolean;
  onSalvar: (etapa: string, inicio: string, fim: string) => void; onCancelar?: () => void;
}) {
  const agora = isoParaLocalSP(new Date());
  const [etapa, setEtapa] = useState(inicial?.etapa ?? etapas[0]);
  const [ini, setIni] = useState(inicial ? isoParaLocalSP(inicial.inicio) : agora);
  const [fim, setFim] = useState(inicial?.fim ? isoParaLocalSP(inicial.fim) : agora);
  return (
    <div className="grade" style={{ marginTop: "0.6rem", alignItems: "end" }}>
      <div className="campo"><label>Etapa</label>
        <select value={etapa} onChange={(e) => setEtapa(e.target.value)}>{etapas.map((e) => <option key={e} value={e}>{ETAPAS_TRABALHO[e]}</option>)}</select>
      </div>
      <div className="campo"><label>Início</label><input type="datetime-local" value={ini} onChange={(e) => setIni(e.target.value)} /></div>
      <div className="campo"><label>Fim</label><input type="datetime-local" value={fim} onChange={(e) => setFim(e.target.value)} /></div>
      <div className="campo acoes">
        <button type="button" className="pequeno" disabled={pendente} onClick={() => onSalvar(etapa, ini, fim)}>Salvar</button>
        {onCancelar && <button type="button" className="contorno pequeno" onClick={onCancelar}>Cancelar</button>}
      </div>
    </div>
  );
}

function Apontamento({ lote, consumos, insumos, estoque, editavel, agir, pendente, temAberta }: {
  lote: Lote; consumos: Consumo[]; insumos: { id: string; nome: string; unidade: string }[]; estoque: Record<string, number>;
  editavel: boolean; agir: (fn: () => Promise<{ erro?: string; ok?: string }>) => void; pendente: boolean; temAberta: boolean;
}) {
  const [reais, setReais] = useState<Record<string, string>>(() => Object.fromEntries(consumos.map((c) => [c.insumo_id, String(c.real).replace(".", ",")])));
  const [extras, setExtras] = useState<{ insumo_id: string; nome: string; unidade: string }[]>([]);
  const [boas, setBoas] = useState(lote.unidades_boas != null ? String(lote.unidades_boas) : "");
  const [perdas, setPerdas] = useState(String(lote.perdas ?? 0));
  const [produzida, setProduzida] = useState(lote.quantidade_produzida != null ? String(lote.quantidade_produzida).replace(".", ",") : "");
  const [obs, setObs] = useState(lote.observacoes ?? "");
  const [motivo, setMotivo] = useState("");
  const linhas = [...consumos, ...extras.map((e) => ({ ...e, prevista: 0, real: 0, custoUnit: null, custoTotal: null }))];
  const num = (t: string) => Number(String(t).replace(",", "."));

  const payload = () => ({
    id: lote.id,
    consumos: linhas.map((l) => ({ insumo_id: l.insumo_id, quantidade_real: num(reais[l.insumo_id] ?? "0") || 0 })),
    unidades_boas: lote.tipo === "base" ? (boas === "" ? null : Number(boas)) : null,
    perdas: lote.tipo === "base" ? Number(perdas) || 0 : 0,
    quantidade_produzida: lote.tipo === "preparo" ? (produzida === "" ? null : num(produzida)) : null,
    observacoes: obs,
  });

  if (!editavel) {
    return (
      <div className="cartao">
        <h2>Consumo</h2>
        <div className="tabela-rolagem">
          <table>
            <thead><tr><th>Insumo</th><th className="dir">Previsto</th><th className="dir">Real</th><th className="dir">Custo unitário</th><th className="dir">Custo</th></tr></thead>
            <tbody>
              {consumos.map((c) => (
                <tr key={c.insumo_id}>
                  <td>{c.nome}</td>
                  <td className="dir num">{fmt(c.prevista)} {c.unidade}</td>
                  <td className="dir num">{fmt(c.real)} {c.unidade}</td>
                  <td className="dir num">{c.custoUnit != null ? (c.unidade === "un" ? formatarBRL(Math.round(c.custoUnit)) + "/un" : formatarBRL(Math.round(c.custoUnit * 1000)) + (c.unidade === "ml" ? "/L" : "/kg")) : "—"}</td>
                  <td className="dir num">{c.custoTotal != null ? formatarBRL(Math.round(c.custoTotal)) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {lote.observacoes && <p style={{ marginTop: "0.75rem" }}>Obs.: {lote.observacoes}</p>}
      </div>
    );
  }

  const disponiveis = insumos.filter((i) => !linhas.some((l) => l.insumo_id === i.id));
  return (
    <div className="cartao">
      <h2>Consumo real e resultado</h2>
      <p className="suave" style={{ fontSize: "0.9rem" }}>Já vem com o previsto. Corrija o que usou de verdade, inclusive reposições. A baixa no estoque acontece ao concluir.</p>
      <div className="tabela-rolagem">
        <table>
          <thead><tr><th>Insumo</th><th className="dir">Previsto</th><th style={{ width: 140 }}>Real</th><th className="dir">Em estoque</th></tr></thead>
          <tbody>
            {linhas.map((l) => {
              const real = num(reais[l.insumo_id] ?? "0") || 0;
              const tem = estoque[l.insumo_id] ?? 0;
              return (
                <tr key={l.insumo_id}>
                  <td>{l.nome}</td>
                  <td className="dir num">{fmt(l.prevista)} {l.unidade}</td>
                  <td><input inputMode="decimal" aria-label={`Consumo real de ${l.nome}`} value={reais[l.insumo_id] ?? ""}
                    onChange={(e) => setReais((r) => ({ ...r, [l.insumo_id]: e.target.value }))} /></td>
                  <td className="dir num" style={tem < real && l.nome !== "Água filtrada" ? { color: "var(--erro)" } : undefined}>{fmt(tem)} {l.unidade}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {disponiveis.length > 0 && (
        <div className="acoes" style={{ margin: "0.6rem 0 1rem" }}>
          <select aria-label="Adicionar insumo" defaultValue="" onChange={(e) => {
            const i = insumos.find((x) => x.id === e.target.value);
            if (i) { setExtras((x) => [...x, { insumo_id: i.id, nome: i.nome, unidade: i.unidade }]); setReais((r) => ({ ...r, [i.id]: "" })); }
            e.target.value = "";
          }} style={{ maxWidth: 280 }}>
            <option value="">+ Adicionar insumo usado…</option>
            {disponiveis.map((i) => <option key={i.id} value={i.id}>{i.nome} ({i.unidade})</option>)}
          </select>
        </div>
      )}
      <div className="grade">
        {lote.tipo === "base" ? (
          <>
            <div className="campo"><label htmlFor="boas">Bases boas</label><input id="boas" type="number" min={0} value={boas} onChange={(e) => setBoas(e.target.value)} />
              <span className="ajuda">Os pedidos deste lote precisam de {lote.bases_pedidos}.</span></div>
            <div className="campo"><label htmlFor="perdas">Perdas</label><input id="perdas" type="number" min={0} value={perdas} onChange={(e) => setPerdas(e.target.value)} />
              <span className="ajuda">Perdas aumentam o custo de cada base boa.</span></div>
          </>
        ) : (
          <div className="campo"><label htmlFor="prod">Quantidade produzida ({lote.unidadeProduto})</label><input id="prod" inputMode="decimal" value={produzida} onChange={(e) => setProduzida(e.target.value)} /></div>
        )}
      </div>
      <div className="campo"><label htmlFor="obs">Observações (temperatura, textura, resultado)</label><textarea id="obs" value={obs} onChange={(e) => setObs(e.target.value)} /></div>
      <div className="acoes">
        <button type="button" className="contorno" disabled={pendente} onClick={() => agir(() => salvarApontamento(payload()))}>Salvar</button>
        <button type="button" className="bordo" disabled={pendente || temAberta} title={temAberta ? "Pause o cronômetro antes" : undefined}
          onClick={() => {
            if (!confirm("Concluir o lote? O estoque será baixado e os custos ficam gravados.")) return;
            agir(async () => { const r = await salvarApontamento(payload()); if (r.erro) return r; return concluirLote(lote.id); });
          }}>Concluir lote</button>
        {temAberta && <span className="suave" style={{ fontSize: "0.85rem" }}>Pause o cronômetro para concluir.</span>}
      </div>
      <hr />
      <details>
        <summary className="suave" style={{ cursor: "pointer" }}>Cancelar este lote</summary>
        <div className="acoes" style={{ marginTop: "0.6rem" }}>
          <input placeholder="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} style={{ maxWidth: 320 }} />
          <button type="button" className="contorno" disabled={pendente}
            onClick={() => { if (confirm("Cancelar o lote? Os pedidos voltam para a fila.")) agir(() => cancelarLote(lote.id, motivo)); }}>Cancelar lote</button>
        </div>
      </details>
    </div>
  );
}
