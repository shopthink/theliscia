-- The Liscia Pizzas · Status de produção real, tabela nutricional e dados de rótulo
--
-- * O pedido passa a "Em produção" só quando o lote começa de verdade (primeiro play ou espera).
-- * Cada insumo guarda a composição nutricional por 100 g (ou 100 ml, conforme a unidade).
-- * Cada receita de base guarda os dados do rótulo e uma tabela nutricional VALIDADA pelo proprietário.
--   O sistema calcula uma sugestão; a etiqueta só imprime com a tabela validada.

create or replace function public.criar_lote(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r            public.receitas%rowtype;
  v            public.receita_versoes%rowtype;
  c            public.configuracoes%rowtype;
  v_id         uuid;
  v_itens      uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'item_ids', '[]'::jsonb))::uuid), '{}');
  v_extras     integer := coalesce((p->>'bases_extras')::integer, 0);
  v_peso       numeric := nullif(p->>'peso_bolinha_g', '')::numeric;
  v_qtd_prep   numeric := nullif(p->>'quantidade_planejada', '')::numeric;
  v_bases_ped  integer := 0;
  v_bases      integer;
  v_fator      numeric;
  v_validos    integer;
  v_sacolas    integer := 0;
begin
  if not public.pode_administrar() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  select * into r from public.receitas where id = (p->>'receita_id')::uuid;
  if not found or not r.ativa then raise exception 'Escolha a receita.' using errcode = 'P0001'; end if;
  select * into v from public.receita_versoes where id = r.versao_atual_id;
  if not found then raise exception 'A receita ainda não tem ficha técnica.' using errcode = 'P0001'; end if;
  select * into c from public.configuracoes limit 1;
  if v_extras < 0 then raise exception 'Bases extras inválidas.' using errcode = 'P0001'; end if;

  if r.tipo = 'base' then
    v_peso := coalesce(v_peso, v.peso_bolinha_g);
    if coalesce(v_peso, 0) <= 0 then raise exception 'Informe o peso da bolinha.' using errcode = 'P0001'; end if;

    -- Itens: da mesma receita, de pedidos confirmados, ainda sem lote
    select count(*), coalesce(sum(i.quantidade), 0) into v_validos, v_bases_ped
      from public.pedido_itens i
      join public.pedidos pd on pd.id = i.pedido_id
     where i.id = any(v_itens) and i.receita_id = r.id and i.lote_id is null
       and pd.status_producao in ('confirmado', 'em_producao');
    if v_validos <> coalesce(array_length(v_itens, 1), 0) then
      raise exception 'Algum item escolhido já está em outro lote ou não é desta receita. Recarregue a página.' using errcode = 'P0001';
    end if;
    v_bases := v_bases_ped + v_extras;
    if v_bases <= 0 then raise exception 'Escolha pedidos ou informe bases extras.' using errcode = 'P0001'; end if;
    v_fator := v_bases * v_peso / v.massa_base_g;
  else
    if coalesce(v_qtd_prep, 0) <= 0 then raise exception 'Informe quanto quer produzir.' using errcode = 'P0001'; end if;
    v_fator := v_qtd_prep / v.rendimento;
  end if;

  insert into public.lotes (tipo, receita_id, receita_versao_id, data_planejada, peso_bolinha_g,
                            bases_pedidos, bases_extras, massa_planejada_g, quantidade_planejada, observacoes, criado_por)
  values (r.tipo, r.id, v.id, coalesce((p->>'data_planejada')::date, public.hoje_sp()),
          case when r.tipo = 'base' then v_peso end,
          v_bases_ped, case when r.tipo = 'base' then v_extras else 0 end,
          case when r.tipo = 'base' then round(v_bases * v_peso, 3) end,
          case when r.tipo = 'preparo' then v_qtd_prep end,
          nullif(trim(coalesce(p->>'observacoes', '')), ''), auth.uid())
  returning id into v_id;

  -- Ingredientes da ficha técnica
  insert into public.lote_consumos (lote_id, insumo_id, quantidade_prevista, quantidade_real)
  select v_id, g.insumo_id, round(g.quantidade * v_fator, 3), round(g.quantidade * v_fator, 3)
    from public.receita_versao_ingredientes g where g.receita_versao_id = v.id;

  if r.tipo = 'base' then
    -- Sacola: uma por pedido, no primeiro lote que o pedido entra
    with peds as (
      update public.pedidos pd set sacola_lote_id = v_id
       where pd.sacola_lote_id is null
         and pd.id in (select i.pedido_id from public.pedido_itens i where i.id = any(v_itens))
      returning 1)
    select count(*) into v_sacolas from peds;

    insert into public.lote_consumos (lote_id, insumo_id, quantidade_prevista, quantidade_real)
    select v_id, i.id, round(x.qtd, 3), round(x.qtd, 3)
      from (values ('semola', v_bases * c.semola_g_por_base),
                   ('saco_vacuo', v_bases * c.saco_vacuo_por_base),
                   ('etiqueta', v_bases * c.etiqueta_por_base),
                   ('molho', v_bases * c.molho_g_por_base),
                   ('sacola', v_sacolas * c.sacola_por_pedido)) as x(uso, qtd)
      join public.insumos i on i.uso_auxiliar = x.uso
     where x.qtd > 0
    on conflict (lote_id, insumo_id) do update set
      quantidade_prevista = lote_consumos.quantidade_prevista + excluded.quantidade_prevista,
      quantidade_real = lote_consumos.quantidade_real + excluded.quantidade_real;

    -- O pedido só passa a "Em produção" quando o lote começa de verdade (primeiro play ou espera)
    update public.pedido_itens set lote_id = v_id where id = any(v_itens);
  end if;

  return v_id;
end;
$$;

-- Marcos do lote; ao começar, os pedidos do lote passam para "Em produção"
create or replace function public.atualizar_marcos_lote(p_lote_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_status text;
begin
  update public.lotes l set
    produzido_em = (select public.hoje_sp(min(s.inicio)) from public.lote_sessoes s
                     where s.lote_id = l.id and s.etapa in ('massa', 'molho')),
    assado_em    = (select public.hoje_sp(min(s.inicio)) from public.lote_sessoes s
                     where s.lote_id = l.id and s.etapa = 'assar'),
    congelado_em = (select public.hoje_sp(min(e.inicio)) from public.lote_esperas e
                     where e.lote_id = l.id and e.tipo = 'freezer'),
    status = case when l.status = 'planejado'
                   and (exists (select 1 from public.lote_sessoes s where s.lote_id = l.id)
                        or exists (select 1 from public.lote_esperas e where e.lote_id = l.id))
                  then 'em_producao' else l.status end
  where l.id = p_lote_id
  returning status into v_status;

  if v_status = 'em_producao' then
    update public.pedidos set status_producao = 'em_producao'
     where id in (select pedido_id from public.pedido_itens where lote_id = p_lote_id)
       and status_producao = 'confirmado';
  end if;
end;
$$;

-- Pedidos que já estavam em lotes ainda não iniciados voltam para "Confirmado"
update public.pedidos pd set status_producao = 'confirmado'
 where pd.status_producao = 'em_producao'
   and not exists (select 1 from public.pedido_itens i join public.lotes l on l.id = i.lote_id
                    where i.pedido_id = pd.id and l.status in ('em_producao', 'concluido'));

-- ---------------------------------------------------------------------------
-- Composição nutricional por 100 g (insumos em g) ou 100 ml (insumos em ml)
-- ---------------------------------------------------------------------------
alter table public.insumos
  add column nutri_kcal              numeric(8,2) check (nutri_kcal >= 0),
  add column nutri_carboidratos_g    numeric(8,2) check (nutri_carboidratos_g >= 0),
  add column nutri_acucares_totais_g numeric(8,2) check (nutri_acucares_totais_g >= 0),
  add column nutri_acucares_adic_g   numeric(8,2) check (nutri_acucares_adic_g >= 0),
  add column nutri_proteinas_g       numeric(8,2) check (nutri_proteinas_g >= 0),
  add column nutri_gorduras_g        numeric(8,2) check (nutri_gorduras_g >= 0),
  add column nutri_saturadas_g       numeric(8,2) check (nutri_saturadas_g >= 0),
  add column nutri_trans_g           numeric(8,2) check (nutri_trans_g >= 0),
  add column nutri_fibras_g          numeric(8,2) check (nutri_fibras_g >= 0),
  add column nutri_sodio_mg          numeric(10,2) check (nutri_sodio_mg >= 0),
  add column nutri_fonte             text;

-- Valores de REFERÊNCIA (tabelas públicas, aproximados). Confirme pelo rótulo do seu fornecedor.
update public.insumos i set
  nutri_kcal = v.kcal, nutri_carboidratos_g = v.carb, nutri_acucares_totais_g = v.acu, nutri_acucares_adic_g = 0,
  nutri_proteinas_g = v.prot, nutri_gorduras_g = v.gord, nutri_saturadas_g = v.sat, nutri_trans_g = 0,
  nutri_fibras_g = v.fib, nutri_sodio_mg = v.sod,
  nutri_fonte = 'Referência aproximada (TACO/USDA). Confirme no rótulo do fornecedor.'
from (values
  ('Farinha',                    360, 75.1, 0.3, 9.8,  1.4, 0.2,  2.3, 1),
  ('Cerveja',                     41,  3.3, 0,   0.6,  0,   0,    0,   4),
  ('Água filtrada',                0,  0,   0,   0,    0,   0,    0,   0),
  ('Sal',                          0,  0,   0,   0,    0,   0,    0,   39300),
  ('Fermento biológico fresco',  105, 18.1, 0,   8.4,  1.9, 0.2,  8.1, 30),
  ('Azeite',                     804,  0,   0,   0,   91,  12.6,  0,   2),
  ('Sêmola de abertura',         360, 72.8, 0,  12.7,  1.1, 0.2,  3.9, 1),
  ('Tomate',                      15,  3.1, 2.6, 1.1,  0.2, 0,    1.2, 1)
) as v(nome, kcal, carb, acu, prot, gord, sat, fib, sod)
where i.nome = v.nome;

-- ---------------------------------------------------------------------------
-- Dados de rótulo por receita e tabela validada
-- ---------------------------------------------------------------------------
alter table public.receitas
  add column rotulo_nome          text,
  add column rotulo_ingredientes  text,
  add column rotulo_alergenicos   text,
  add column rotulo_conservacao   text,
  add column rotulo_preparo       text,
  add column validade_dias        integer check (validade_dias > 0),
  add column peso_assado_g        numeric(8,2) check (peso_assado_g > 0),
  add column porcao_g             numeric(8,2) check (porcao_g > 0),
  add column porcao_medida        text,
  add column nutricao             jsonb,          -- tabela validada, por 100 g do produto assado
  add column nutricao_versao_id   uuid references public.receita_versoes(id) on delete set null,
  add column nutricao_validada_em timestamptz,
  add column nutricao_validada_por uuid;

update public.receitas set
  rotulo_nome = case codigo when 'italiana' then 'Base de pizza pré-assada congelada · Italiana clássica'
                            when 'ny' then 'Base de pizza pré-assada congelada · NY style' end,
  rotulo_ingredientes = case codigo
    when 'italiana' then 'Farinha de trigo enriquecida com ferro e ácido fólico, cerveja, água, sal e fermento biológico.'
    when 'ny' then 'Farinha de trigo enriquecida com ferro e ácido fólico, cerveja, água, azeite de oliva, sal e fermento biológico.' end,
  rotulo_alergenicos = 'ALÉRGICOS: CONTÉM TRIGO E CEVADA. CONTÉM GLÚTEN.',
  rotulo_conservacao = 'Conservar congelado a -18 °C ou mais frio. Após descongelada, não recongelar.',
  rotulo_preparo = 'Sem descongelar, adicione a cobertura e leve ao forno preaquecido a 250 °C por 8 a 10 minutos.',
  validade_dias = 90
where codigo in ('italiana', 'ny');

-- Dados do fabricante para o rótulo
alter table public.configuracoes
  add column rotulo_fabricante text,
  add column rotulo_documento  text,
  add column rotulo_endereco   text,
  add column rotulo_contato    text;

-- Valida a tabela nutricional de uma receita (só o administrador)
create or replace function public.validar_nutricao(p_receita_id uuid, p_valores jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare k text;
begin
  if not public.pode_administrar() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  foreach k in array array['kcal','carboidratos_g','acucares_totais_g','acucares_adic_g','proteinas_g','gorduras_g','saturadas_g','trans_g','fibras_g','sodio_mg'] loop
    if not (p_valores ? k) or (p_valores->>k) is null or (p_valores->>k)::numeric < 0 then
      raise exception 'Preencha todos os valores da tabela (%).', k using errcode = 'P0001';
    end if;
  end loop;
  update public.receitas set
    nutricao = p_valores,
    nutricao_versao_id = versao_atual_id,
    nutricao_validada_em = now(),
    nutricao_validada_por = auth.uid()
  where id = p_receita_id;
  if not found then raise exception 'Receita não encontrada.' using errcode = 'P0001'; end if;
end;
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.nova_versao_receita(uuid, numeric, jsonb, text, numeric) to authenticated;
grant execute on function public.aprovar_solicitacao(uuid, integer, text, timestamptz) to authenticated;
grant execute on function public.recusar_solicitacao(uuid, text) to authenticated;
grant execute on function public.criar_pedido_manual(text, text, text, text, date, text, jsonb, uuid, jsonb) to authenticated;
grant execute on function public.campanha_pode_vender(uuid) to authenticated;
grant execute on function public.salvar_compra(jsonb) to authenticated;
grant execute on function public.excluir_compra(uuid, text) to authenticated;
grant execute on function public.registrar_ajuste_estoque(uuid, numeric, text, text, date) to authenticated;
grant execute on function public.custo_unitario_atual(uuid) to authenticated;
grant execute on function public.criar_lote(jsonb) to authenticated;
grant execute on function public.iniciar_etapa(uuid, text, timestamptz) to authenticated;
grant execute on function public.pausar_producao(timestamptz) to authenticated;
grant execute on function public.registrar_sessao(uuid, text, timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.excluir_sessao(uuid) to authenticated;
grant execute on function public.iniciar_espera(uuid, text, timestamptz) to authenticated;
grant execute on function public.encerrar_espera(uuid, timestamptz) to authenticated;
grant execute on function public.marcar_lembrete(uuid) to authenticated;
grant execute on function public.salvar_apontamento_lote(jsonb) to authenticated;
grant execute on function public.concluir_lote(uuid, integer) to authenticated;
grant execute on function public.cancelar_lote(uuid, text) to authenticated;
grant execute on function public.validar_nutricao(uuid, jsonb) to authenticated;
grant execute on all functions in schema public to service_role;
