-- The Liscia Pizzas · Fase 2: fornecedores, compras com rateio, estoque e custo médio móvel.
--
-- Decisões:
-- * Rateio de frete/taxas/desconto em centavos, pelo maior resto, dentro do banco.
-- * Estoque é um livro de movimentos imutável. O saldo (quantidade e valor) é mantido por gatilho.
-- * Custo médio móvel = valor em estoque / quantidade em estoque. Saídas (fase 3) usam esse custo.
-- * Editar ou excluir uma compra lança estornos; nunca apaga nem reescreve movimentos.

-- ---------------------------------------------------------------------------
-- Fornecedores
-- ---------------------------------------------------------------------------
create table public.fornecedores (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null check (length(trim(nome)) between 1 and 120),
  contato      text,
  observacoes  text,
  ativo        boolean not null default true,
  criado_em    timestamptz not null default now()
);
create unique index fornecedores_nome_unico on public.fornecedores (lower(trim(nome)));

-- ---------------------------------------------------------------------------
-- Insumos auxiliares: qual insumo é a sêmola, o saco a vácuo etc. (para a lista de compras)
-- ---------------------------------------------------------------------------
alter table public.insumos
  add column uso_auxiliar text unique
  check (uso_auxiliar in ('semola', 'saco_vacuo', 'etiqueta', 'molho', 'sacola'));

update public.insumos set uso_auxiliar = 'semola'     where nome = 'Sêmola de abertura';
update public.insumos set uso_auxiliar = 'saco_vacuo' where nome = 'Saco para vácuo';
update public.insumos set uso_auxiliar = 'etiqueta'   where nome = 'Etiqueta';
update public.insumos set uso_auxiliar = 'molho'      where nome = 'Molho de marcação';
update public.insumos set uso_auxiliar = 'sacola'     where nome = 'Sacola kraft';

-- ---------------------------------------------------------------------------
-- Compras
-- ---------------------------------------------------------------------------
create sequence public.compra_numero_seq;

create table public.compras (
  id                    uuid primary key default gen_random_uuid(),
  numero                integer not null unique default nextval('public.compra_numero_seq'),
  fornecedor_id         uuid not null references public.fornecedores(id) on delete restrict,
  data                  date not null,
  canal                 text not null check (canal in ('presencial', 'online')),
  minutos_trabalho      integer not null default 0 check (minutos_trabalho between 0 and 1440),
  valor_hora_centavos   integer not null check (valor_hora_centavos >= 0),  -- copiado das configurações
  custo_tempo_centavos  integer generated always as
                        ((round(minutos_trabalho * valor_hora_centavos / 60.0))::integer) stored,
  frete_centavos        integer not null default 0 check (frete_centavos >= 0),
  servico_centavos      integer not null default 0 check (servico_centavos >= 0),
  outras_centavos       integer not null default 0 check (outras_centavos >= 0),
  desconto_centavos     integer not null default 0 check (desconto_centavos >= 0),
  subtotal_centavos     integer not null check (subtotal_centavos >= 0),
  total_centavos        integer not null check (total_centavos >= 0),
  ocr_texto             text,
  ocr_total_centavos    integer,
  observacoes           text,
  cancelada             boolean not null default false,
  cancelada_em          timestamptz,
  cancelada_motivo      text,
  criado_por            uuid,
  versao                integer not null default 1,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);
create index on public.compras (data desc);
create trigger compras_versionar before update on public.compras
  for each row execute function public.tg_versionar();

create table public.compra_itens (
  id                     uuid primary key default gen_random_uuid(),
  compra_id              uuid not null references public.compras(id) on delete cascade,
  ordem                  integer not null default 0,
  insumo_id              uuid not null references public.insumos(id) on delete restrict,
  descricao_original     text,
  pacotes                numeric(12,3) not null check (pacotes > 0),
  conteudo               numeric(12,3) not null check (conteudo > 0),
  unidade_conteudo       text not null check (unidade_conteudo in ('g', 'kg', 'ml', 'l', 'un')),
  quantidade_base        numeric(14,3) not null check (quantidade_base > 0),
  valor_linha_centavos   integer not null check (valor_linha_centavos >= 0),
  rateio_centavos        integer not null,
  custo_final_centavos   integer not null check (custo_final_centavos >= 0)
);
create index on public.compra_itens (compra_id);

-- ---------------------------------------------------------------------------
-- Estoque: movimentos imutáveis + saldo por insumo
-- ---------------------------------------------------------------------------
create table public.estoque_movimentos (
  id              uuid primary key default gen_random_uuid(),
  insumo_id       uuid not null references public.insumos(id) on delete restrict,
  tipo            text not null check (tipo in ('compra', 'producao', 'ajuste', 'perda', 'estorno')),
  quantidade      numeric(14,3) not null check (quantidade <> 0),     -- positiva entra, negativa sai
  valor_centavos  numeric(16,4) not null,                               -- mesmo sinal da quantidade
  data            date not null,
  compra_id       uuid references public.compras(id) on delete restrict,
  lote_id         uuid,                                                 -- fase 3
  motivo          text,
  criado_por      uuid,
  criado_em       timestamptz not null default now()
);
create index on public.estoque_movimentos (insumo_id, criado_em);
create index on public.estoque_movimentos (compra_id);

create table public.estoque_saldos (
  insumo_id       uuid primary key references public.insumos(id) on delete cascade,
  quantidade      numeric(14,3) not null default 0,
  valor_centavos  numeric(16,4) not null default 0,
  atualizado_em   timestamptz not null default now()
);

create or replace function public.tg_estoque_saldo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.estoque_saldos (insumo_id, quantidade, valor_centavos)
  values (new.insumo_id, new.quantidade, new.valor_centavos)
  on conflict (insumo_id) do update set
    quantidade = public.estoque_saldos.quantidade + excluded.quantidade,
    valor_centavos = case
      when public.estoque_saldos.quantidade + excluded.quantidade = 0 then 0
      else public.estoque_saldos.valor_centavos + excluded.valor_centavos end,
    atualizado_em = now();
  return null;
end;
$$;
create trigger estoque_movimentos_saldo after insert on public.estoque_movimentos
  for each row execute function public.tg_estoque_saldo();

create or replace function public.tg_estoque_imutavel()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Movimentos de estoque não podem ser alterados nem apagados. Lance um estorno ou ajuste.'
    using errcode = 'P0001';
end;
$$;
create trigger estoque_movimentos_imutavel before update or delete on public.estoque_movimentos
  for each row execute function public.tg_estoque_imutavel();

-- Custo unitário atual: médio do estoque; sem estoque, a estimativa do insumo.
create or replace function public.custo_unitario_atual(p_insumo_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.valor_centavos / s.quantidade from public.estoque_saldos s
      where s.insumo_id = p_insumo_id and s.quantidade > 0 and s.valor_centavos >= 0),
    (select i.preco_ref_centavos from public.insumos i where i.id = p_insumo_id),
    0);
$$;

-- Estorna tudo o que uma compra ainda tem lançado no estoque (líquido por insumo)
create or replace function public.estornar_compra_no_estoque(p_compra_id uuid, p_data date, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.estoque_movimentos (insumo_id, tipo, quantidade, valor_centavos, data, compra_id, motivo, criado_por)
  select m.insumo_id, 'estorno', -sum(m.quantidade), -sum(m.valor_centavos), p_data, p_compra_id, p_motivo, auth.uid()
    from public.estoque_movimentos m
   where m.compra_id = p_compra_id
   group by m.insumo_id
  having sum(m.quantidade) <> 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- Salvar compra (nova ou edição) de forma atômica
-- p: {
--   id?, versao?, fornecedor_id? | fornecedor_nome?, data, canal, minutos_trabalho,
--   frete_centavos, servico_centavos, outras_centavos, desconto_centavos,
--   observacoes?, ocr_texto?, ocr_total_centavos?,
--   itens: [{insumo_id, descricao_original?, pacotes, conteudo, unidade_conteudo, valor_linha_centavos}]
-- }
-- ---------------------------------------------------------------------------
create or replace function public.salvar_compra(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id          uuid := nullif(p->>'id', '')::uuid;
  v_forn        uuid := nullif(p->>'fornecedor_id', '')::uuid;
  v_forn_nome   text := nullif(trim(coalesce(p->>'fornecedor_nome', '')), '');
  v_data        date := (p->>'data')::date;
  v_canal       text := p->>'canal';
  v_min         integer := coalesce((p->>'minutos_trabalho')::integer, 0);
  v_frete       integer := coalesce((p->>'frete_centavos')::integer, 0);
  v_serv        integer := coalesce((p->>'servico_centavos')::integer, 0);
  v_outras      integer := coalesce((p->>'outras_centavos')::integer, 0);
  v_desc        integer := coalesce((p->>'desconto_centavos')::integer, 0);
  v_itens       jsonb := p->'itens';
  v_n           integer;
  v_sub         bigint := 0;
  v_extras      bigint;
  v_vals        bigint[] := '{}';
  v_parc        bigint[] := '{}';
  v_frac        numeric[] := '{}';
  v_resto       bigint;
  v_bruto       numeric;
  v_idx         integer;
  v_atual       public.compras%rowtype;
  e             jsonb;
  v_ins         public.insumos%rowtype;
  v_un          text;
  v_fator       numeric;
  v_qtd         numeric;
  v_final       bigint;
begin
  if not public.pode_administrar() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  -- Cabeçalho
  if v_data is null then raise exception 'Informe a data da compra.' using errcode = 'P0001'; end if;
  if v_canal not in ('presencial', 'online') then raise exception 'Escolha o canal: presencial ou online.' using errcode = 'P0001'; end if;
  if v_min < 0 or v_min > 1440 then raise exception 'Tempo de compra inválido.' using errcode = 'P0001'; end if;
  if least(v_frete, v_serv, v_outras, v_desc) < 0 then raise exception 'Valores negativos não são aceitos.' using errcode = 'P0001'; end if;

  if v_forn is null then
    if v_forn_nome is null then raise exception 'Escolha ou cadastre o fornecedor.' using errcode = 'P0001'; end if;
    insert into public.fornecedores (nome) values (v_forn_nome)
      on conflict ((lower(trim(nome)))) do update set ativo = true
      returning id into v_forn;
  elsif not exists (select 1 from public.fornecedores where id = v_forn) then
    raise exception 'Fornecedor não encontrado.' using errcode = 'P0001';
  end if;

  -- Itens
  if v_itens is null or jsonb_typeof(v_itens) <> 'array' then
    raise exception 'Adicione ao menos um item.' using errcode = 'P0001';
  end if;
  v_n := jsonb_array_length(v_itens);
  if v_n = 0 then raise exception 'Adicione ao menos um item.' using errcode = 'P0001'; end if;
  if v_n > 80 then raise exception 'Muitos itens numa compra só.' using errcode = 'P0001'; end if;

  for i in 1..v_n loop
    e := v_itens->(i - 1);
    if coalesce((e->>'valor_linha_centavos')::bigint, -1) < 0 then
      raise exception 'Item %: informe o valor da linha.', i using errcode = 'P0001';
    end if;
    v_vals := v_vals || (e->>'valor_linha_centavos')::bigint;
    v_sub := v_sub + (e->>'valor_linha_centavos')::bigint;
  end loop;

  v_extras := v_frete + v_serv + v_outras - v_desc;
  if v_sub = 0 and v_extras <> 0 then
    raise exception 'Informe os valores dos itens antes de ratear frete e taxas.' using errcode = 'P0001';
  end if;
  if v_sub + v_extras < 0 then
    raise exception 'O desconto é maior que o valor da compra.' using errcode = 'P0001';
  end if;

  -- Rateio proporcional em centavos, distribuindo o resto pelo maior resíduo
  for i in 1..v_n loop
    v_bruto := case when v_sub = 0 then 0 else v_vals[i]::numeric * v_extras / v_sub end;
    v_parc := v_parc || floor(v_bruto)::bigint;
    v_frac := v_frac || (v_bruto - floor(v_bruto));
  end loop;
  v_resto := v_extras - (select coalesce(sum(x), 0) from unnest(v_parc) x);
  for v_idx in
    select f.i from unnest(v_frac) with ordinality as f(frac, i)
     order by f.frac desc, f.i asc
     limit greatest(v_resto, 0)
  loop
    v_parc[v_idx] := v_parc[v_idx] + 1;
  end loop;

  -- Cria ou atualiza o cabeçalho
  if v_id is null then
    insert into public.compras (fornecedor_id, data, canal, minutos_trabalho, valor_hora_centavos,
                                frete_centavos, servico_centavos, outras_centavos, desconto_centavos,
                                subtotal_centavos, total_centavos, ocr_texto, ocr_total_centavos, observacoes, criado_por)
    values (v_forn, v_data, v_canal, v_min, (select valor_hora_centavos from public.configuracoes limit 1),
            v_frete, v_serv, v_outras, v_desc, v_sub, v_sub + v_extras,
            nullif(p->>'ocr_texto', ''), nullif(p->>'ocr_total_centavos', '')::integer,
            nullif(trim(coalesce(p->>'observacoes', '')), ''), auth.uid())
    returning id into v_id;
  else
    select * into v_atual from public.compras where id = v_id for update;
    if not found then raise exception 'Compra não encontrada.' using errcode = 'P0001'; end if;
    if v_atual.cancelada then raise exception 'Esta compra foi excluída.' using errcode = 'P0001'; end if;
    if p ? 'versao' and (p->>'versao')::integer <> v_atual.versao then
      raise exception 'Esta compra foi alterada em outra aba ou dispositivo. Recarregue a página.' using errcode = 'P0001';
    end if;
    perform public.estornar_compra_no_estoque(v_id, v_data, 'Edição da compra');
    delete from public.compra_itens where compra_id = v_id;
    update public.compras set
      fornecedor_id = v_forn, data = v_data, canal = v_canal, minutos_trabalho = v_min,
      frete_centavos = v_frete, servico_centavos = v_serv, outras_centavos = v_outras, desconto_centavos = v_desc,
      subtotal_centavos = v_sub, total_centavos = v_sub + v_extras,
      ocr_texto = coalesce(nullif(p->>'ocr_texto', ''), ocr_texto),
      ocr_total_centavos = coalesce(nullif(p->>'ocr_total_centavos', '')::integer, ocr_total_centavos),
      observacoes = nullif(trim(coalesce(p->>'observacoes', '')), '')
    where id = v_id;
  end if;

  -- Itens + entradas de estoque
  for i in 1..v_n loop
    e := v_itens->(i - 1);
    select * into v_ins from public.insumos where id = nullif(e->>'insumo_id', '')::uuid;
    if not found then raise exception 'Item %: escolha o insumo.', i using errcode = 'P0001'; end if;
    v_un := lower(coalesce(e->>'unidade_conteudo', ''));
    v_fator := case v_un when 'g' then 1 when 'kg' then 1000 when 'ml' then 1 when 'l' then 1000 when 'un' then 1 end;
    if v_fator is null
       or (v_ins.unidade = 'g'  and v_un not in ('g', 'kg'))
       or (v_ins.unidade = 'ml' and v_un not in ('ml', 'l'))
       or (v_ins.unidade = 'un' and v_un <> 'un') then
      raise exception 'Item % (%): a embalagem precisa estar em %.', i, v_ins.nome,
        case v_ins.unidade when 'g' then 'g ou kg' when 'ml' then 'ml ou L' else 'unidades' end
        using errcode = 'P0001';
    end if;
    if coalesce((e->>'pacotes')::numeric, 0) <= 0 or coalesce((e->>'conteudo')::numeric, 0) <= 0 then
      raise exception 'Item % (%): informe quantos pacotes e o conteúdo de cada um.', i, v_ins.nome using errcode = 'P0001';
    end if;
    v_qtd := round((e->>'pacotes')::numeric * (e->>'conteudo')::numeric * v_fator, 3);
    v_final := v_vals[i] + v_parc[i];
    if v_final < 0 then
      raise exception 'Item % (%): o desconto deixa o custo negativo. Reduza o desconto geral.', i, v_ins.nome using errcode = 'P0001';
    end if;

    insert into public.compra_itens (compra_id, ordem, insumo_id, descricao_original, pacotes, conteudo, unidade_conteudo,
                                     quantidade_base, valor_linha_centavos, rateio_centavos, custo_final_centavos)
    values (v_id, i, v_ins.id, nullif(trim(coalesce(e->>'descricao_original', '')), ''),
            (e->>'pacotes')::numeric, (e->>'conteudo')::numeric, v_un,
            v_qtd, v_vals[i], v_parc[i], v_final);

    insert into public.estoque_movimentos (insumo_id, tipo, quantidade, valor_centavos, data, compra_id, criado_por)
    values (v_ins.id, 'compra', v_qtd, v_final, v_data, v_id, auth.uid());
  end loop;

  return v_id;
end;
$$;

-- Excluir compra: estorna o estoque e marca como cancelada (o registro fica no histórico)
create or replace function public.excluir_compra(p_compra_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare c public.compras%rowtype;
begin
  if not public.pode_administrar() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  select * into c from public.compras where id = p_compra_id for update;
  if not found then raise exception 'Compra não encontrada.' using errcode = 'P0001'; end if;
  if c.cancelada then return; end if;
  perform public.estornar_compra_no_estoque(c.id, public.hoje_sp(), coalesce(nullif(trim(p_motivo), ''), 'Compra excluída'));
  update public.compras set cancelada = true, cancelada_em = now(),
         cancelada_motivo = nullif(trim(coalesce(p_motivo, '')), '')
   where id = c.id;
end;
$$;

-- Ajuste de estoque ou perda, sempre com motivo, valorizado ao custo atual
create or replace function public.registrar_ajuste_estoque(
  p_insumo_id uuid, p_quantidade numeric, p_tipo text, p_motivo text, p_data date default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_custo numeric;
begin
  if not public.pode_administrar() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if p_tipo not in ('ajuste', 'perda') then raise exception 'Tipo inválido.' using errcode = 'P0001'; end if;
  if p_quantidade is null or p_quantidade = 0 then raise exception 'Informe a quantidade.' using errcode = 'P0001'; end if;
  if p_tipo = 'perda' and p_quantidade > 0 then raise exception 'Perda reduz o estoque: use quantidade negativa.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.insumos where id = p_insumo_id) then
    raise exception 'Insumo não encontrado.' using errcode = 'P0001';
  end if;
  perform 1 from public.estoque_saldos where insumo_id = p_insumo_id for update;
  v_custo := public.custo_unitario_atual(p_insumo_id);
  insert into public.estoque_movimentos (insumo_id, tipo, quantidade, valor_centavos, data, motivo, criado_por)
  values (p_insumo_id, p_tipo, p_quantidade, round(p_quantidade * v_custo, 4),
          coalesce(p_data, public.hoje_sp()), trim(p_motivo), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS e permissões
-- ---------------------------------------------------------------------------
alter table public.fornecedores        enable row level security;
alter table public.compras             enable row level security;
alter table public.compra_itens        enable row level security;
alter table public.estoque_movimentos  enable row level security;
alter table public.estoque_saldos      enable row level security;

create policy adm_all  on public.fornecedores       for all    to authenticated using (public.is_admin()) with check (public.is_admin());
-- Compras, itens, movimentos e saldos mudam só pelas funções acima
create policy adm_read on public.compras            for select to authenticated using (public.is_admin());
create policy adm_read on public.compra_itens       for select to authenticated using (public.is_admin());
create policy adm_read on public.estoque_movimentos for select to authenticated using (public.is_admin());
create policy adm_read on public.estoque_saldos     for select to authenticated using (public.is_admin());

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.nova_versao_receita(uuid, numeric, jsonb, text) to authenticated;
grant execute on function public.aprovar_solicitacao(uuid, integer, text, timestamptz) to authenticated;
grant execute on function public.recusar_solicitacao(uuid, text) to authenticated;
grant execute on function public.criar_pedido_manual(text, text, text, text, date, text, jsonb, uuid, jsonb) to authenticated;
grant execute on function public.campanha_pode_vender(uuid) to authenticated;
grant execute on function public.salvar_compra(jsonb) to authenticated;
grant execute on function public.excluir_compra(uuid, text) to authenticated;
grant execute on function public.registrar_ajuste_estoque(uuid, numeric, text, text, date) to authenticated;
grant execute on function public.custo_unitario_atual(uuid) to authenticated;
grant execute on all functions in schema public to service_role;
