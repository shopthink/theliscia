-- The Liscia Pizzas · Fase 3: produção
--
-- Decisões:
-- * Trabalho é medido por cronômetro: sessões (play/pause) por etapa. Só uma sessão aberta por vez,
--   o que impede contar duas tarefas simultâneas. Horas ativas = soma das sessões.
-- * Esperas (descanso, geladeira, esfriar, freezer) são registradas, mas nunca contam como trabalho.
-- * Lote de bases consome ingredientes + auxiliares e entrega pedidos; lote de preparo (molho)
--   consome ingredientes e devolve um insumo ao estoque, valorizado pelo custo dos materiais.
-- * Na conclusão, o custo unitário aplicado a cada ingrediente fica gravado no lote.

-- ---------------------------------------------------------------------------
-- Molho em gramas, tomate e tempos de referência
-- ---------------------------------------------------------------------------
update public.insumos set unidade = 'g'
 where nome = 'Molho de marcação' and unidade = 'ml'
   and not exists (select 1 from public.estoque_movimentos m where m.insumo_id = insumos.id)
   and not exists (select 1 from public.insumo_embalagens e where e.insumo_id = insumos.id);

alter table public.configuracoes rename column molho_ml_por_base to molho_g_por_base;

insert into public.insumos (nome, unidade, categoria, entra_lista_compras, observacoes)
values ('Tomate', 'g', 'ingrediente', true, 'Para o molho caseiro.')
on conflict (nome) do nothing;

alter table public.configuracoes
  add column descanso_min       integer not null default 120  check (descanso_min >= 0),
  add column dobra_min          integer not null default 60   check (dobra_min >= 0),
  add column geladeira_min      integer not null default 2880 check (geladeira_min >= 0),
  add column freezer_min        integer not null default 1440 check (freezer_min >= 0),
  add column esfriar_min        integer not null default 30   check (esfriar_min >= 0);

-- ---------------------------------------------------------------------------
-- Receitas de preparo (ex.: molho) que produzem um insumo
-- ---------------------------------------------------------------------------
alter table public.receitas
  add column tipo text not null default 'base' check (tipo in ('base', 'preparo')),
  add column produz_insumo_id uuid references public.insumos(id) on delete restrict,
  add constraint receita_preparo_produz check (tipo = 'base' or produz_insumo_id is not null);

alter table public.receita_versoes
  alter column peso_bolinha_g drop not null,
  add column rendimento numeric(14,3) check (rendimento > 0);  -- preparo: quanto do insumo a receita-base rende

drop function public.nova_versao_receita(uuid, numeric, jsonb, text);

create function public.nova_versao_receita(
  p_receita_id     uuid,
  p_peso_bolinha_g numeric,
  p_ingredientes   jsonb,
  p_observacoes    text default null,
  p_rendimento     numeric default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero integer; v_id uuid; v_massa numeric; v_tipo text;
begin
  if not public.pode_administrar() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if p_ingredientes is null or jsonb_typeof(p_ingredientes) <> 'array' or jsonb_array_length(p_ingredientes) = 0 then
    raise exception 'Informe ao menos um ingrediente.' using errcode = 'P0001';
  end if;
  select tipo into v_tipo from public.receitas where id = p_receita_id for update;
  if not found then raise exception 'Receita não encontrada.' using errcode = 'P0001'; end if;
  if v_tipo = 'base' and coalesce(p_peso_bolinha_g, 0) <= 0 then
    raise exception 'Informe o peso da bolinha.' using errcode = 'P0001';
  end if;
  if v_tipo = 'preparo' and coalesce(p_rendimento, 0) <= 0 then
    raise exception 'Informe quanto a receita rende.' using errcode = 'P0001';
  end if;

  select coalesce(max(numero), 0) + 1 into v_numero from public.receita_versoes where receita_id = p_receita_id;
  select sum((e->>'quantidade')::numeric * coalesce((e->>'densidade_g')::numeric, 1)) into v_massa
    from jsonb_array_elements(p_ingredientes) e;

  insert into public.receita_versoes (receita_id, numero, peso_bolinha_g, massa_base_g, rendimento, observacoes, criado_por)
  values (p_receita_id, v_numero, case when v_tipo = 'base' then p_peso_bolinha_g end, v_massa,
          case when v_tipo = 'preparo' then p_rendimento end, p_observacoes, auth.uid())
  returning id into v_id;

  insert into public.receita_versao_ingredientes (receita_versao_id, insumo_id, quantidade, densidade_g)
  select v_id, (e->>'insumo_id')::uuid, (e->>'quantidade')::numeric, coalesce((e->>'densidade_g')::numeric, 1)
    from jsonb_array_elements(p_ingredientes) e;

  update public.receitas set versao_atual_id = v_id where id = p_receita_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lotes
-- ---------------------------------------------------------------------------
create sequence public.lote_numero_seq;

create table public.lotes (
  id                         uuid primary key default gen_random_uuid(),
  numero                     integer not null unique default nextval('public.lote_numero_seq'),
  tipo                       text not null check (tipo in ('base', 'preparo')),
  receita_id                 uuid not null references public.receitas(id) on delete restrict,
  receita_versao_id          uuid not null references public.receita_versoes(id) on delete restrict,
  status                     text not null default 'planejado'
                             check (status in ('planejado', 'em_producao', 'concluido', 'cancelado')),
  data_planejada             date not null,
  peso_bolinha_g             numeric(10,2),
  bases_pedidos              integer not null default 0 check (bases_pedidos >= 0),
  bases_extras               integer not null default 0 check (bases_extras >= 0),
  massa_planejada_g          numeric(14,3),
  quantidade_planejada       numeric(14,3),            -- preparo, na unidade do insumo produzido
  unidades_boas              integer check (unidades_boas >= 0),
  perdas                     integer not null default 0 check (perdas >= 0),
  quantidade_produzida       numeric(14,3) check (quantidade_produzida >= 0),
  observacoes                text,
  produzido_em               date,
  assado_em                  date,
  congelado_em               date,
  valor_hora_centavos        integer,
  minutos_ativos             numeric(10,2),
  custo_materiais_centavos   numeric(16,4),
  custo_mao_obra_centavos    integer,
  custo_total_centavos       numeric(16,4),
  custo_por_unidade_centavos numeric(16,6),
  concluido_em               timestamptz,
  cancelado_em               timestamptz,
  cancelado_motivo           text,
  criado_por                 uuid,
  versao                     integer not null default 1,
  criado_em                  timestamptz not null default now(),
  atualizado_em              timestamptz not null default now()
);
create index on public.lotes (status, data_planejada);
create trigger lotes_versionar before update on public.lotes
  for each row execute function public.tg_versionar();

create table public.lote_consumos (
  lote_id                  uuid not null references public.lotes(id) on delete cascade,
  insumo_id                uuid not null references public.insumos(id) on delete restrict,
  quantidade_prevista      numeric(14,3) not null default 0 check (quantidade_prevista >= 0),
  quantidade_real          numeric(14,3) not null default 0 check (quantidade_real >= 0),
  custo_unitario_centavos  numeric(16,6),
  custo_total_centavos     numeric(16,4),
  primary key (lote_id, insumo_id)
);

create table public.lote_sessoes (
  id          uuid primary key default gen_random_uuid(),
  lote_id     uuid not null references public.lotes(id) on delete cascade,
  etapa       text not null check (etapa in ('massa', 'bolear', 'molho', 'abrir', 'assar', 'embalar', 'limpeza', 'outro')),
  inicio      timestamptz not null,
  fim         timestamptz,
  manual      boolean not null default false,
  criado_em   timestamptz not null default now(),
  constraint sessao_ordem check (fim is null or fim >= inicio)
);
create index on public.lote_sessoes (lote_id, inicio);
-- Um cronômetro por vez: nunca duas tarefas contadas ao mesmo tempo
create unique index lote_sessoes_uma_aberta on public.lote_sessoes ((true)) where fim is null;

create table public.lote_esperas (
  id                 uuid primary key default gen_random_uuid(),
  lote_id            uuid not null references public.lotes(id) on delete cascade,
  tipo               text not null check (tipo in ('descanso', 'geladeira', 'esfriar', 'freezer')),
  inicio             timestamptz not null default now(),
  fim                timestamptz,
  alvo_min           integer not null check (alvo_min >= 0),
  lembrete_min       integer check (lembrete_min > 0),
  lembrete_feito_em  timestamptz,
  constraint espera_ordem check (fim is null or fim >= inicio)
);
create index on public.lote_esperas (lote_id, inicio);

alter table public.pedido_itens
  add constraint pedido_itens_lote_fk foreign key (lote_id) references public.lotes(id) on delete set null;
alter table public.estoque_movimentos
  add constraint estoque_movimentos_lote_fk foreign key (lote_id) references public.lotes(id) on delete restrict;
alter table public.pedidos add column sacola_lote_id uuid references public.lotes(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Criar lote: calcula ingredientes e auxiliares no servidor
-- p: {receita_id, data_planejada, peso_bolinha_g?, item_ids?: [uuid], bases_extras?, quantidade_planejada?, observacoes?}
-- ---------------------------------------------------------------------------
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

    update public.pedido_itens set lote_id = v_id where id = any(v_itens);
    update public.pedidos set status_producao = 'em_producao'
     where id in (select pedido_id from public.pedido_itens where lote_id = v_id)
       and status_producao = 'confirmado';
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cronômetro
-- ---------------------------------------------------------------------------
create or replace function public.lote_editavel(p_lote_id uuid)
returns public.lotes
language plpgsql
security definer
set search_path = public
as $$
declare l public.lotes%rowtype;
begin
  if not public.pode_administrar() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  select * into l from public.lotes where id = p_lote_id for update;
  if not found then raise exception 'Lote não encontrado.' using errcode = 'P0001'; end if;
  if l.status in ('concluido', 'cancelado') then
    raise exception 'Este lote já foi %.', case l.status when 'concluido' then 'concluído' else 'cancelado' end using errcode = 'P0001';
  end if;
  return l;
end;
$$;

-- Marca datas da etiqueta e o status a partir das sessões e esperas
create or replace function public.atualizar_marcos_lote(p_lote_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
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
  where l.id = p_lote_id;
$$;

-- Pausa o que estiver rodando (em qualquer lote)
create or replace function public.pausar_producao(p_agora timestamptz default now())
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.pode_administrar() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  update public.lote_sessoes set fim = greatest(p_agora, inicio) where fim is null;
end;
$$;

-- Play numa etapa: pausa a sessão que estiver aberta e abre outra
create or replace function public.iniciar_etapa(p_lote_id uuid, p_etapa text, p_agora timestamptz default now())
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform public.lote_editavel(p_lote_id);
  perform public.pausar_producao(p_agora);
  insert into public.lote_sessoes (lote_id, etapa, inicio) values (p_lote_id, p_etapa, p_agora) returning id into v_id;
  perform public.atualizar_marcos_lote(p_lote_id);
  return v_id;
end;
$$;

-- Lançamento ou correção manual de uma sessão (esqueceu de apertar play)
create or replace function public.registrar_sessao(
  p_lote_id uuid, p_etapa text, p_inicio timestamptz, p_fim timestamptz, p_sessao_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform public.lote_editavel(p_lote_id);
  if p_inicio is null or p_fim is null then raise exception 'Informe início e fim.' using errcode = 'P0001'; end if;
  if p_fim < p_inicio then raise exception 'O fim não pode ser antes do início.' using errcode = 'P0001'; end if;
  if p_fim > now() + interval '5 minutes' then raise exception 'O fim não pode estar no futuro.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.lote_sessoes s
              where (p_sessao_id is null or s.id <> p_sessao_id)
                and tstzrange(s.inicio, coalesce(s.fim, now()), '[)') && tstzrange(p_inicio, p_fim, '[)')) then
    raise exception 'Esse horário se sobrepõe a outra sessão de trabalho.' using errcode = 'P0001';
  end if;
  if p_sessao_id is null then
    insert into public.lote_sessoes (lote_id, etapa, inicio, fim, manual)
    values (p_lote_id, p_etapa, p_inicio, p_fim, true) returning id into v_id;
  else
    update public.lote_sessoes set etapa = p_etapa, inicio = p_inicio, fim = p_fim, manual = true
     where id = p_sessao_id and lote_id = p_lote_id returning id into v_id;
    if v_id is null then raise exception 'Sessão não encontrada.' using errcode = 'P0001'; end if;
  end if;
  perform public.atualizar_marcos_lote(p_lote_id);
  return v_id;
end;
$$;

create or replace function public.excluir_sessao(p_sessao_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_lote uuid;
begin
  select lote_id into v_lote from public.lote_sessoes where id = p_sessao_id;
  if v_lote is null then raise exception 'Sessão não encontrada.' using errcode = 'P0001'; end if;
  perform public.lote_editavel(v_lote);
  delete from public.lote_sessoes where id = p_sessao_id;
  perform public.atualizar_marcos_lote(v_lote);
end;
$$;

-- Esperas: começar pausa o trabalho em andamento
create or replace function public.iniciar_espera(p_lote_id uuid, p_tipo text, p_agora timestamptz default now())
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; c public.configuracoes%rowtype;
begin
  perform public.lote_editavel(p_lote_id);
  select * into c from public.configuracoes limit 1;
  perform public.pausar_producao(p_agora);
  update public.lote_esperas set fim = p_agora where lote_id = p_lote_id and fim is null;
  insert into public.lote_esperas (lote_id, tipo, inicio, alvo_min, lembrete_min)
  values (p_lote_id, p_tipo, p_agora,
          case p_tipo when 'descanso' then c.descanso_min when 'geladeira' then c.geladeira_min
                      when 'freezer' then c.freezer_min else c.esfriar_min end,
          case when p_tipo = 'descanso' and c.dobra_min > 0 then c.dobra_min end)
  returning id into v_id;
  perform public.atualizar_marcos_lote(p_lote_id);
  return v_id;
end;
$$;

create or replace function public.encerrar_espera(p_espera_id uuid, p_agora timestamptz default now())
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_lote uuid;
begin
  select lote_id into v_lote from public.lote_esperas where id = p_espera_id;
  if v_lote is null then raise exception 'Espera não encontrada.' using errcode = 'P0001'; end if;
  perform public.lote_editavel(v_lote);
  update public.lote_esperas set fim = greatest(p_agora, inicio) where id = p_espera_id and fim is null;
end;
$$;

create or replace function public.marcar_lembrete(p_espera_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_lote uuid;
begin
  select lote_id into v_lote from public.lote_esperas where id = p_espera_id;
  if v_lote is null then raise exception 'Espera não encontrada.' using errcode = 'P0001'; end if;
  perform public.lote_editavel(v_lote);
  update public.lote_esperas set lembrete_feito_em = now() where id = p_espera_id and lembrete_feito_em is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Apontamento (consumo real, unidades, observações) e conclusão
-- p: {id, versao?, consumos: [{insumo_id, quantidade_real}], unidades_boas?, perdas?, quantidade_produzida?, observacoes?}
-- ---------------------------------------------------------------------------
create or replace function public.salvar_apontamento_lote(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare l public.lotes%rowtype; e jsonb;
begin
  l := public.lote_editavel((p->>'id')::uuid);
  if p ? 'versao' and (p->>'versao')::integer <> l.versao then
    raise exception 'Este lote foi alterado em outra aba ou dispositivo. Recarregue a página.' using errcode = 'P0001';
  end if;
  for e in select * from jsonb_array_elements(coalesce(p->'consumos', '[]'::jsonb)) loop
    if coalesce((e->>'quantidade_real')::numeric, -1) < 0 then
      raise exception 'Consumo inválido.' using errcode = 'P0001';
    end if;
    insert into public.lote_consumos (lote_id, insumo_id, quantidade_prevista, quantidade_real)
    values (l.id, (e->>'insumo_id')::uuid, 0, (e->>'quantidade_real')::numeric)
    on conflict (lote_id, insumo_id) do update set quantidade_real = excluded.quantidade_real;
  end loop;
  -- Remove linhas extras zeradas (não previstas)
  delete from public.lote_consumos where lote_id = l.id and quantidade_prevista = 0 and quantidade_real = 0;
  update public.lotes set
    unidades_boas = case when p ? 'unidades_boas' then nullif(p->>'unidades_boas', '')::integer else unidades_boas end,
    perdas = case when p ? 'perdas' then coalesce(nullif(p->>'perdas', '')::integer, 0) else perdas end,
    quantidade_produzida = case when p ? 'quantidade_produzida' then nullif(p->>'quantidade_produzida', '')::numeric else quantidade_produzida end,
    observacoes = case when p ? 'observacoes' then nullif(trim(p->>'observacoes'), '') else observacoes end
  where id = l.id;
end;
$$;

create or replace function public.concluir_lote(p_lote_id uuid, p_versao integer default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  l          public.lotes%rowtype;
  r          public.receitas%rowtype;
  v_hora     integer;
  v_min      numeric;
  v_mat      numeric := 0;
  v_mo       integer;
  v_unid     numeric;
  v_aloc     integer;
  cons       record;
  v_custo    numeric;
begin
  l := public.lote_editavel(p_lote_id);
  if p_versao is not null and p_versao <> l.versao then
    raise exception 'Este lote foi alterado em outra aba ou dispositivo. Recarregue a página.' using errcode = 'P0001';
  end if;
  select * into r from public.receitas where id = l.receita_id;
  if exists (select 1 from public.lote_sessoes where lote_id = l.id and fim is null) then
    raise exception 'Pause o cronômetro antes de concluir.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.lote_sessoes where lote_id = l.id) then
    raise exception 'Nenhum tempo de trabalho registrado neste lote.' using errcode = 'P0001';
  end if;

  if l.tipo = 'base' then
    if coalesce(l.unidades_boas, 0) <= 0 then raise exception 'Informe quantas bases boas saíram.' using errcode = 'P0001'; end if;
    select coalesce(sum(quantidade), 0) into v_aloc from public.pedido_itens where lote_id = l.id;
    if l.unidades_boas < v_aloc then
      raise exception 'Saíram % bases boas, mas os pedidos deste lote precisam de %. Faça a reposição neste lote antes de concluir.',
        l.unidades_boas, v_aloc using errcode = 'P0001';
    end if;
    v_unid := l.unidades_boas;
  else
    if coalesce(l.quantidade_produzida, 0) <= 0 then raise exception 'Informe quanto foi produzido.' using errcode = 'P0001'; end if;
    v_unid := l.quantidade_produzida;
  end if;

  -- Fecha esperas abertas
  update public.lote_esperas set fim = greatest(now(), inicio) where lote_id = l.id and fim is null;

  -- Materiais pelo custo médio atual, gravado no lote, e saída do estoque
  for cons in select * from public.lote_consumos where lote_id = l.id and quantidade_real > 0 loop
    perform 1 from public.estoque_saldos where insumo_id = cons.insumo_id for update;
    v_custo := public.custo_unitario_atual(cons.insumo_id);
    update public.lote_consumos set custo_unitario_centavos = v_custo,
           custo_total_centavos = round(cons.quantidade_real * v_custo, 4)
     where lote_id = l.id and insumo_id = cons.insumo_id;
    v_mat := v_mat + round(cons.quantidade_real * v_custo, 4);
    insert into public.estoque_movimentos (insumo_id, tipo, quantidade, valor_centavos, data, lote_id, motivo, criado_por)
    values (cons.insumo_id, 'producao', -cons.quantidade_real, -round(cons.quantidade_real * v_custo, 4),
            coalesce(l.produzido_em, public.hoje_sp()), l.id, 'Lote L-' || lpad(l.numero::text, 4, '0'), auth.uid());
  end loop;

  select coalesce(sum(extract(epoch from (fim - inicio))) / 60.0, 0) into v_min
    from public.lote_sessoes where lote_id = l.id;
  select valor_hora_centavos into v_hora from public.configuracoes limit 1;
  v_mo := round(v_min * v_hora / 60.0)::integer;

  -- Preparo devolve o insumo produzido ao estoque, pelo custo dos materiais
  if l.tipo = 'preparo' then
    insert into public.estoque_movimentos (insumo_id, tipo, quantidade, valor_centavos, data, lote_id, motivo, criado_por)
    values (r.produz_insumo_id, 'producao', l.quantidade_produzida, v_mat,
            coalesce(l.produzido_em, public.hoje_sp()), l.id, 'Produzido no lote L-' || lpad(l.numero::text, 4, '0'), auth.uid());
  end if;

  update public.lotes set
    status = 'concluido', concluido_em = now(),
    valor_hora_centavos = v_hora, minutos_ativos = round(v_min, 2),
    custo_materiais_centavos = v_mat, custo_mao_obra_centavos = v_mo,
    custo_total_centavos = v_mat + v_mo,
    custo_por_unidade_centavos = (v_mat + v_mo) / v_unid
  where id = l.id;

  -- Pedidos com todos os itens em lotes concluídos ficam prontos
  update public.pedidos pd set status_producao = 'pronto'
   where pd.id in (select pedido_id from public.pedido_itens where lote_id = l.id)
     and pd.status_producao in ('confirmado', 'em_producao')
     and not exists (select 1 from public.pedido_itens i left join public.lotes lt on lt.id = i.lote_id
                      where i.pedido_id = pd.id and (lt.id is null or lt.status <> 'concluido'));
end;
$$;

create or replace function public.cancelar_lote(p_lote_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare l public.lotes%rowtype;
begin
  l := public.lote_editavel(p_lote_id);
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo.' using errcode = 'P0001'; end if;
  update public.lote_sessoes set fim = greatest(now(), inicio) where lote_id = l.id and fim is null;
  update public.lote_esperas set fim = greatest(now(), inicio) where lote_id = l.id and fim is null;
  update public.pedidos set sacola_lote_id = null where sacola_lote_id = l.id;
  update public.pedidos pd set status_producao = 'confirmado'
   where pd.id in (select pedido_id from public.pedido_itens where lote_id = l.id)
     and pd.status_producao = 'em_producao'
     and not exists (select 1 from public.pedido_itens i where i.pedido_id = pd.id and i.lote_id is not null and i.lote_id <> l.id);
  update public.pedido_itens set lote_id = null where lote_id = l.id;
  update public.lotes set status = 'cancelado', cancelado_em = now(), cancelado_motivo = trim(p_motivo) where id = l.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS e permissões
-- ---------------------------------------------------------------------------
alter table public.lotes         enable row level security;
alter table public.lote_consumos enable row level security;
alter table public.lote_sessoes  enable row level security;
alter table public.lote_esperas  enable row level security;

create policy adm_read on public.lotes         for select to authenticated using (public.is_admin());
create policy adm_read on public.lote_consumos for select to authenticated using (public.is_admin());
create policy adm_read on public.lote_sessoes  for select to authenticated using (public.is_admin());
create policy adm_read on public.lote_esperas  for select to authenticated using (public.is_admin());

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
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
grant execute on all functions in schema public to service_role;
