-- The Liscia Pizzas · Fase 1: campanhas, solicitações públicas com Pix, pedidos e pagamentos.

-- ---------------------------------------------------------------------------
-- Campanhas
-- ---------------------------------------------------------------------------
create table public.campanhas (
  id                        uuid primary key default gen_random_uuid(),
  nome                      text not null check (length(trim(nome)) between 1 and 80),
  ativa                     boolean not null default false,
  abre_em                   date not null,
  fecha_em                  date not null,      -- inclusiva até 23h59 de São Paulo
  entrega_em                date not null,
  permite_entrega           boolean not null default true,
  permite_retirada          boolean not null default true,
  instrucoes_entrega        text,
  regiao_atendida           text,
  retirada_info             text,
  frete_info                text,
  pedido_minimo             integer not null default 3 check (pedido_minimo between 1 and 100),
  pix_chave                 text,
  pix_favorecido            text,
  pix_cidade                text not null default 'Sao Paulo',  -- exigido pelo Pix copia e cola
  percentual_sinal          integer not null default 100 check (percentual_sinal in (50, 100)),
  horas_envio_comprovante   integer not null default 24 check (horas_envio_comprovante between 1 and 168),
  versao                    integer not null default 1,
  criado_em                 timestamptz not null default now(),
  atualizado_em             timestamptz not null default now(),
  constraint campanha_datas_abertura check (abre_em <= fecha_em),
  constraint campanha_datas_entrega  check (entrega_em >= fecha_em),
  constraint campanha_modalidade     check (permite_entrega or permite_retirada)
);
-- No máximo uma campanha ativa: é ela que aparece em /pedido
create unique index campanhas_uma_ativa on public.campanhas ((true)) where ativa;
create trigger campanhas_versionar before update on public.campanhas
  for each row execute function public.tg_versionar();

create table public.campanha_produtos (
  id              uuid primary key default gen_random_uuid(),
  campanha_id     uuid not null references public.campanhas(id) on delete cascade,
  receita_id      uuid not null references public.receitas(id) on delete restrict,
  nome            text not null check (length(trim(nome)) between 1 and 80),
  descricao       text check (descricao is null or length(descricao) <= 400),
  preco_centavos  integer not null check (preco_centavos > 0 and preco_centavos <= 1000000),
  foto_url        text,
  ordem           integer not null default 0,
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now()
);
create index on public.campanha_produtos (campanha_id);

-- Uma campanha só pode estar ativa com Pix, favorecido e ao menos um produto com preço válido.
create or replace function public.campanha_pode_vender(p_campanha_id uuid)
returns text  -- null = ok; senão, motivo
language sql
stable
security definer
set search_path = public
as $$
  select case
    when c.id is null then 'Campanha não encontrada.'
    when coalesce(trim(c.pix_chave), '') = '' then 'Informe a chave Pix.'
    when coalesce(trim(c.pix_favorecido), '') = '' then 'Informe o nome do favorecido do Pix.'
    when not exists (select 1 from public.campanha_produtos p
                     where p.campanha_id = c.id and p.ativo and p.preco_centavos > 0)
      then 'Cadastre ao menos um produto ativo com preço.'
    else null
  end
  from (select 1) x
  left join public.campanhas c on c.id = p_campanha_id;
$$;

create or replace function public.tg_campanha_ativacao()
returns trigger
language plpgsql
as $$
declare v_motivo text;
begin
  if new.ativa then
    v_motivo := public.campanha_pode_vender(new.id);
    if v_motivo is not null then
      raise exception 'Não é possível ativar as vendas: %', v_motivo using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
-- AFTER: enxerga o estado já gravado (inclusive na criação com produtos na mesma transação)
create constraint trigger campanhas_ativacao
  after insert or update on public.campanhas
  deferrable initially deferred
  for each row execute function public.tg_campanha_ativacao();

create or replace function public.tg_produto_campanha_ativa()
returns trigger
language plpgsql
as $$
declare v_camp uuid := coalesce(new.campanha_id, old.campanha_id); v_motivo text;
begin
  if exists (select 1 from public.campanhas where id = v_camp and ativa) then
    v_motivo := public.campanha_pode_vender(v_camp);
    if v_motivo is not null then
      raise exception 'A campanha está ativa: %. Pause as vendas antes.', v_motivo using errcode = 'P0001';
    end if;
  end if;
  return null;
end;
$$;
create constraint trigger campanha_produtos_ativa
  after update or delete on public.campanha_produtos
  deferrable initially deferred
  for each row execute function public.tg_produto_campanha_ativa();

-- Campanha aberta para novos pedidos neste instante?
create or replace function public.campanha_aberta(p_campanha_id uuid, p_agora timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.campanhas c
    where c.id = p_campanha_id
      and c.ativa
      and public.hoje_sp(p_agora) between c.abre_em and c.fecha_em
  );
$$;

-- ---------------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------------
create table public.clientes (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  telefone    text not null unique,   -- só dígitos, com DDD
  endereco    text,
  criado_em   timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Solicitações públicas (reserva + Pix aguardando conferência)
-- Tudo o que o cliente viu fica fotografado aqui: preços, produtos, entrega, Pix.
-- ---------------------------------------------------------------------------
create sequence public.solicitacao_numero_seq;
create sequence public.pedido_numero_seq;

create table public.solicitacoes (
  id                  uuid primary key default gen_random_uuid(),
  numero              integer not null unique default nextval('public.solicitacao_numero_seq'),
  token               text not null unique,
  campanha_id         uuid not null references public.campanhas(id) on delete restrict,
  campanha_nome       text not null,
  cliente_id          uuid not null references public.clientes(id) on delete restrict,
  cliente_nome        text not null,
  cliente_telefone    text not null,
  modalidade          text not null check (modalidade in ('entrega','retirada')),
  endereco            text,
  observacoes         text,
  entrega_em          date not null,
  pix_chave           text not null,
  pix_favorecido      text not null,
  pix_cidade          text not null,
  percentual_sinal    integer not null check (percentual_sinal in (50,100)),
  total_centavos      integer not null check (total_centavos > 0),
  sinal_centavos      integer not null check (sinal_centavos > 0),
  saldo_centavos      integer not null check (saldo_centavos >= 0),
  total_bases         integer not null check (total_bases > 0),
  status              text not null default 'aguardando_pagamento'
                      check (status in ('aguardando_pagamento','em_conferencia','aprovada','recusada')),
  comprovante_ate     timestamptz not null,
  origem_hash         text,
  pedido_id           uuid unique,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),
  constraint solicitacao_valores check (sinal_centavos + saldo_centavos = total_centavos)
);
create index on public.solicitacoes (status, criado_em desc);
create index on public.solicitacoes (origem_hash, criado_em desc);

create table public.solicitacao_itens (
  id                     uuid primary key default gen_random_uuid(),
  solicitacao_id         uuid not null references public.solicitacoes(id) on delete cascade,
  campanha_produto_id    uuid not null references public.campanha_produtos(id) on delete restrict,
  receita_id             uuid not null references public.receitas(id) on delete restrict,
  receita_versao_id      uuid not null references public.receita_versoes(id) on delete restrict,
  nome                   text not null,
  quantidade             integer not null check (quantidade > 0),
  preco_unit_centavos    integer not null check (preco_unit_centavos > 0),
  subtotal_centavos      integer not null check (subtotal_centavos > 0)
);
create index on public.solicitacao_itens (solicitacao_id);

create table public.comprovantes (
  id               uuid primary key default gen_random_uuid(),
  solicitacao_id   uuid not null references public.solicitacoes(id) on delete cascade,
  storage_path     text not null unique,
  mime             text not null check (mime in ('image/jpeg','image/png','image/webp','application/pdf')),
  tamanho_bytes    integer not null check (tamanho_bytes > 0 and tamanho_bytes <= 8388608),
  enviado_em       timestamptz not null default now()
);
create index on public.comprovantes (solicitacao_id, enviado_em desc);

create table public.conferencias (
  id                        uuid primary key default gen_random_uuid(),
  solicitacao_id            uuid not null unique references public.solicitacoes(id) on delete restrict,
  decisao                   text not null check (decisao in ('aprovada','recusada')),
  motivo                    text,
  valor_recebido_centavos   integer check (valor_recebido_centavos >= 0),
  referencia_transacao      text,
  admin_id                  uuid,
  decidido_em               timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Pedidos confirmados (o que vai para a produção)
-- Pagamento e produção têm status separados.
-- ---------------------------------------------------------------------------
create table public.pedidos (
  id                  uuid primary key default gen_random_uuid(),
  numero              integer not null unique default nextval('public.pedido_numero_seq'),
  cliente_id          uuid not null references public.clientes(id) on delete restrict,
  cliente_nome        text not null,
  cliente_telefone    text not null,
  origem              text not null check (origem in ('manual','link')),
  campanha_id         uuid references public.campanhas(id) on delete restrict,
  solicitacao_id      uuid unique references public.solicitacoes(id) on delete restrict,
  modalidade          text not null check (modalidade in ('entrega','retirada')),
  endereco            text,
  entrega_em          date not null,
  observacoes         text,
  total_centavos      integer not null check (total_centavos >= 0),
  recebido_centavos   integer not null default 0 check (recebido_centavos >= 0),
  status_pagamento    text not null default 'pendente'
                      check (status_pagamento in ('pendente','em_conferencia','sinal_confirmado','integral_confirmado','recusado')),
  status_producao     text not null default 'confirmado'
                      check (status_producao in ('confirmado','em_producao','pronto','entregue','cancelado')),
  entregue_em         timestamptz,
  criado_por          uuid,
  versao              integer not null default 1,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);
create index on public.pedidos (entrega_em);
create index on public.pedidos (status_producao);
create trigger pedidos_versionar before update on public.pedidos
  for each row execute function public.tg_versionar();

alter table public.solicitacoes
  add constraint solicitacoes_pedido_fk foreign key (pedido_id) references public.pedidos(id) on delete restrict;

create table public.pedido_itens (
  id                     uuid primary key default gen_random_uuid(),
  pedido_id              uuid not null references public.pedidos(id) on delete cascade,
  receita_id             uuid not null references public.receitas(id) on delete restrict,
  receita_versao_id      uuid not null references public.receita_versoes(id) on delete restrict,
  nome                   text not null,
  quantidade             integer not null check (quantidade > 0),
  preco_unit_centavos    integer not null check (preco_unit_centavos >= 0),
  subtotal_centavos      integer not null check (subtotal_centavos >= 0),
  lote_id                uuid  -- vínculo com produção (fase 3)
);
create index on public.pedido_itens (pedido_id);

-- Itens ligados a um lote não mudam de quantidade/receita sem tratar o lote
create or replace function public.tg_item_em_lote()
returns trigger
language plpgsql
as $$
begin
  if old.lote_id is not null and (
       tg_op = 'DELETE'
       or new.quantidade <> old.quantidade
       or new.receita_versao_id <> old.receita_versao_id) then
    raise exception 'Item já vinculado a um lote de produção. Ajuste o lote antes.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger pedido_itens_lote before update or delete on public.pedido_itens
  for each row execute function public.tg_item_em_lote();

create table public.pagamentos (
  id               uuid primary key default gen_random_uuid(),
  pedido_id        uuid not null references public.pedidos(id) on delete cascade,
  valor_centavos   integer not null check (valor_centavos > 0),
  recebido_em      timestamptz not null default now(),
  metodo           text not null check (metodo in ('pix','dinheiro','cartao','outro')),
  referencia       text,
  solicitacao_id   uuid references public.solicitacoes(id) on delete restrict,
  conferido_por    uuid,
  criado_em        timestamptz not null default now()
);
create index on public.pagamentos (pedido_id);
create index on public.pagamentos (recebido_em);
-- A mesma transação bancária não pode quitar dois pedidos
create unique index pagamentos_referencia_unica on public.pagamentos (lower(trim(referencia)))
  where referencia is not null and trim(referencia) <> '';

-- Recalcula valor recebido e status de pagamento a partir dos registros de pagamento
create or replace function public.recalcular_pagamento(p_pedido_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_total integer; v_rec integer; v_status text;
begin
  select total_centavos, status_pagamento into v_total, v_status from public.pedidos where id = p_pedido_id for update;
  if not found then return; end if;
  select coalesce(sum(valor_centavos), 0) into v_rec from public.pagamentos where pedido_id = p_pedido_id;
  update public.pedidos set
    recebido_centavos = v_rec,
    status_pagamento = case
      when v_rec >= v_total and v_total > 0 then 'integral_confirmado'
      when v_rec > 0 then 'sinal_confirmado'
      when v_status in ('em_conferencia','recusado') then v_status
      else 'pendente' end
  where id = p_pedido_id;
end;
$$;
revoke all on function public.recalcular_pagamento(uuid) from public;

create or replace function public.tg_pagamentos_recalc()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalcular_pagamento(coalesce(new.pedido_id, old.pedido_id));
  if tg_op = 'UPDATE' and new.pedido_id <> old.pedido_id then
    perform public.recalcular_pagamento(old.pedido_id);
  end if;
  return null;
end;
$$;
create trigger pagamentos_recalc after insert or update or delete on public.pagamentos
  for each row execute function public.tg_pagamentos_recalc();

-- ---------------------------------------------------------------------------
-- Funções de negócio
-- ---------------------------------------------------------------------------

-- Normaliza telefone: só dígitos. Aceita 55 + DDD + número.
create or replace function public.normalizar_telefone(p text)
returns text
language sql
immutable
as $$
  select case
    when length(d) in (12, 13) and left(d, 2) = '55' then substr(d, 3)
    else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x;
$$;

create or replace function public.upsert_cliente(p_nome text, p_telefone text, p_endereco text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  insert into public.clientes (nome, telefone, endereco)
  values (p_nome, p_telefone, nullif(trim(coalesce(p_endereco, '')), ''))
  on conflict (telefone) do update set
    nome = excluded.nome,
    endereco = coalesce(excluded.endereco, public.clientes.endereco),
    atualizado_em = now()
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.upsert_cliente(text, text, text) from public;

-- Cria uma solicitação pública. Chamada somente pelo servidor (service_role).
-- O preço vem sempre do banco; o navegador só informa produto e quantidade.
-- p_itens: [{"produto_id": uuid, "quantidade": int}]
create or replace function public.criar_solicitacao(
  p_itens        jsonb,
  p_nome         text,
  p_telefone     text,
  p_modalidade   text,
  p_endereco     text,
  p_observacoes  text,
  p_origem_hash  text default null,
  p_agora        timestamptz default now()
) returns table (id uuid, token text, numero integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  c            public.campanhas%rowtype;
  v_nome       text := trim(coalesce(p_nome, ''));
  v_tel        text := public.normalizar_telefone(p_telefone);
  v_end        text := nullif(trim(coalesce(p_endereco, '')), '');
  v_obs        text := nullif(trim(coalesce(p_observacoes, '')), '');
  v_total      integer := 0;
  v_bases      integer := 0;
  v_sinal      integer;
  v_cliente    uuid;
  v_id         uuid;
  v_token      text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');  -- 244 bits aleatórios
  v_numero     integer;
  v_item       record;
  v_count      integer;
begin
  -- Limite simples por origem (IP com hash): até 8 solicitações por hora
  if p_origem_hash is not null then
    select count(*) into v_count from public.solicitacoes s
     where s.origem_hash = p_origem_hash and s.criado_em > p_agora - interval '1 hour';
    if v_count >= 8 then
      raise exception 'Muitas tentativas. Aguarde um pouco e tente novamente.' using errcode = 'P0001';
    end if;
  end if;

  select * into c from public.campanhas where ativa for share;
  if not found or not public.campanha_aberta(c.id, p_agora) then
    raise exception 'Os pedidos estão fechados no momento.' using errcode = 'P0001';
  end if;
  if public.campanha_pode_vender(c.id) is not null then
    raise exception 'Os pedidos estão fechados no momento.' using errcode = 'P0001';
  end if;

  if length(v_nome) < 2 or length(v_nome) > 120 then
    raise exception 'Informe seu nome.' using errcode = 'P0001';
  end if;
  if length(v_tel) not in (10, 11) then
    raise exception 'Informe o WhatsApp com DDD.' using errcode = 'P0001';
  end if;
  if p_modalidade not in ('entrega', 'retirada')
     or (p_modalidade = 'entrega' and not c.permite_entrega)
     or (p_modalidade = 'retirada' and not c.permite_retirada) then
    raise exception 'Escolha entre entrega e retirada.' using errcode = 'P0001';
  end if;
  if p_modalidade = 'entrega' and (v_end is null or length(v_end) < 8) then
    raise exception 'Informe o endereço de entrega.' using errcode = 'P0001';
  end if;
  if length(coalesce(v_end, '')) > 300 or length(coalesce(v_obs, '')) > 500 then
    raise exception 'Texto muito longo.' using errcode = 'P0001';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0
     or jsonb_array_length(p_itens) > 20 then
    raise exception 'Escolha ao menos um produto.' using errcode = 'P0001';
  end if;

  -- Valida itens contra os produtos da campanha (preço do banco)
  create temporary table if not exists _itens_sol (
    produto_id uuid, receita_id uuid, receita_versao_id uuid, nome text,
    quantidade integer, preco integer
  ) on commit drop;
  truncate _itens_sol;

  for v_item in
    select (e->>'produto_id') as pid_txt, (e->>'quantidade') as qtd_txt
      from jsonb_array_elements(p_itens) e
  loop
    if v_item.pid_txt !~ '^[0-9a-fA-F-]{36}$' or v_item.qtd_txt !~ '^\d{1,3}$' then
      raise exception 'Itens inválidos.' using errcode = 'P0001';
    end if;
    if v_item.qtd_txt::integer = 0 then continue; end if;
    insert into _itens_sol
      select p.id, p.receita_id, r.versao_atual_id, p.nome, v_item.qtd_txt::integer, p.preco_centavos
        from public.campanha_produtos p
        join public.receitas r on r.id = p.receita_id
       where p.id = v_item.pid_txt::uuid and p.campanha_id = c.id and p.ativo and p.preco_centavos > 0;
    if not found then
      raise exception 'Um dos produtos não está disponível.' using errcode = 'P0001';
    end if;
  end loop;

  -- Agrupa repetições do mesmo produto
  select coalesce(sum(t.quantidade), 0), coalesce(sum(t.quantidade * t.preco), 0)
    into v_bases, v_total from _itens_sol t;

  if v_bases = 0 then
    raise exception 'Escolha ao menos um produto.' using errcode = 'P0001';
  end if;
  if v_bases < c.pedido_minimo then
    raise exception 'O pedido mínimo é de % bases.', c.pedido_minimo using errcode = 'P0001';
  end if;
  if v_bases > 300 then
    raise exception 'Para pedidos grandes, fale com a gente pelo WhatsApp.' using errcode = 'P0001';
  end if;

  v_sinal := round(v_total * c.percentual_sinal / 100.0)::integer;
  v_cliente := public.upsert_cliente(v_nome, v_tel, v_end);

  insert into public.solicitacoes (
    token, campanha_id, campanha_nome, cliente_id, cliente_nome, cliente_telefone,
    modalidade, endereco, observacoes, entrega_em, pix_chave, pix_favorecido, pix_cidade,
    percentual_sinal, total_centavos, sinal_centavos, saldo_centavos, total_bases,
    comprovante_ate, origem_hash, criado_em
  ) values (
    v_token, c.id, c.nome, v_cliente, v_nome, v_tel,
    p_modalidade, case when p_modalidade = 'entrega' then v_end else null end, v_obs,
    c.entrega_em, trim(c.pix_chave), trim(c.pix_favorecido), c.pix_cidade,
    c.percentual_sinal, v_total, v_sinal, v_total - v_sinal, v_bases,
    p_agora + make_interval(hours => c.horas_envio_comprovante), p_origem_hash, p_agora
  ) returning solicitacoes.id, solicitacoes.numero into v_id, v_numero;

  insert into public.solicitacao_itens (solicitacao_id, campanha_produto_id, receita_id, receita_versao_id,
                                        nome, quantidade, preco_unit_centavos, subtotal_centavos)
  select v_id, t.produto_id, t.receita_id, t.receita_versao_id, t.nome, sum(t.quantidade), t.preco, sum(t.quantidade) * t.preco
    from _itens_sol t
   group by t.produto_id, t.receita_id, t.receita_versao_id, t.nome, t.preco;

  return query select v_id, v_token, v_numero;
end;
$$;
revoke all on function public.criar_solicitacao(jsonb, text, text, text, text, text, text, timestamptz) from public;
grant execute on function public.criar_solicitacao(jsonb, text, text, text, text, text, text, timestamptz) to service_role;

-- Registra um comprovante já enviado ao storage privado. Somente o servidor chama.
create or replace function public.registrar_comprovante(
  p_token text, p_storage_path text, p_mime text, p_tamanho integer, p_agora timestamptz default now()
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare s public.solicitacoes%rowtype; v_id uuid; v_qtd integer;
begin
  select * into s from public.solicitacoes where token = p_token for update;
  if not found then raise exception 'Solicitação não encontrada.' using errcode = 'P0001'; end if;
  if s.status not in ('aguardando_pagamento', 'em_conferencia') then
    raise exception 'Esta solicitação já foi analisada.' using errcode = 'P0001';
  end if;
  if p_agora > s.comprovante_ate then
    raise exception 'O prazo para enviar o comprovante terminou. Fale com a gente pelo WhatsApp.' using errcode = 'P0001';
  end if;
  if p_storage_path not like 'solicitacoes/' || s.id::text || '/%' then
    raise exception 'Arquivo inválido.' using errcode = 'P0001';
  end if;
  select count(*) into v_qtd from public.comprovantes where solicitacao_id = s.id;
  if v_qtd >= 5 then
    raise exception 'Limite de envios atingido. Fale com a gente pelo WhatsApp.' using errcode = 'P0001';
  end if;

  insert into public.comprovantes (solicitacao_id, storage_path, mime, tamanho_bytes, enviado_em)
  values (s.id, p_storage_path, p_mime, p_tamanho, p_agora) returning id into v_id;
  update public.solicitacoes set status = 'em_conferencia', atualizado_em = now() where id = s.id;
  return v_id;
end;
$$;
revoke all on function public.registrar_comprovante(text, text, text, integer, timestamptz) from public;
grant execute on function public.registrar_comprovante(text, text, text, integer, timestamptz) to service_role;

-- Aprova uma solicitação: cria o pedido confirmado e o pagamento. Transacional e idempotente.
create or replace function public.aprovar_solicitacao(
  p_solicitacao_id    uuid,
  p_valor_centavos    integer,
  p_referencia        text default null,
  p_recebido_em       timestamptz default now()
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare s public.solicitacoes%rowtype; v_pedido uuid; v_ref text := nullif(trim(coalesce(p_referencia, '')), '');
begin
  if not public.pode_administrar() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  select * into s from public.solicitacoes where id = p_solicitacao_id for update;
  if not found then raise exception 'Solicitação não encontrada.' using errcode = 'P0001'; end if;

  -- Segundo clique / segunda aba: devolve o mesmo pedido, sem duplicar nada
  if s.status = 'aprovada' then return s.pedido_id; end if;
  if s.status = 'recusada' then
    raise exception 'Esta solicitação foi recusada.' using errcode = 'P0001';
  end if;
  if p_valor_centavos is null or p_valor_centavos <= 0 or p_valor_centavos > s.total_centavos then
    raise exception 'Informe o valor efetivamente recebido (até o total do pedido).' using errcode = 'P0001';
  end if;
  if v_ref is not null and exists (
       select 1 from public.pagamentos where lower(trim(referencia)) = lower(v_ref)) then
    raise exception 'Esta identificação de transação já foi usada em outro pagamento.' using errcode = 'P0001';
  end if;

  insert into public.pedidos (
    cliente_id, cliente_nome, cliente_telefone, origem, campanha_id, solicitacao_id,
    modalidade, endereco, entrega_em, observacoes, total_centavos, criado_por
  ) values (
    s.cliente_id, s.cliente_nome, s.cliente_telefone, 'link', s.campanha_id, s.id,
    s.modalidade, s.endereco, s.entrega_em, s.observacoes, s.total_centavos, auth.uid()
  ) returning id into v_pedido;

  insert into public.pedido_itens (pedido_id, receita_id, receita_versao_id, nome, quantidade, preco_unit_centavos, subtotal_centavos)
  select v_pedido, i.receita_id, i.receita_versao_id, i.nome, i.quantidade, i.preco_unit_centavos, i.subtotal_centavos
    from public.solicitacao_itens i where i.solicitacao_id = s.id;

  insert into public.pagamentos (pedido_id, valor_centavos, recebido_em, metodo, referencia, solicitacao_id, conferido_por)
  values (v_pedido, p_valor_centavos, coalesce(p_recebido_em, now()), 'pix', v_ref, s.id, auth.uid());

  insert into public.conferencias (solicitacao_id, decisao, valor_recebido_centavos, referencia_transacao, admin_id)
  values (s.id, 'aprovada', p_valor_centavos, v_ref, auth.uid());

  update public.solicitacoes set status = 'aprovada', pedido_id = v_pedido, atualizado_em = now() where id = s.id;
  return v_pedido;
end;
$$;
revoke all on function public.aprovar_solicitacao(uuid, integer, text, timestamptz) from public;
grant execute on function public.aprovar_solicitacao(uuid, integer, text, timestamptz) to authenticated, service_role;

create or replace function public.recusar_solicitacao(p_solicitacao_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare s public.solicitacoes%rowtype;
begin
  if not public.pode_administrar() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  select * into s from public.solicitacoes where id = p_solicitacao_id for update;
  if not found then raise exception 'Solicitação não encontrada.' using errcode = 'P0001'; end if;
  if s.status = 'recusada' then return; end if;
  if s.status = 'aprovada' then
    raise exception 'Esta solicitação já foi aprovada e virou pedido.' using errcode = 'P0001';
  end if;
  insert into public.conferencias (solicitacao_id, decisao, motivo, admin_id)
  values (s.id, 'recusada', nullif(trim(coalesce(p_motivo, '')), ''), auth.uid());
  update public.solicitacoes set status = 'recusada', atualizado_em = now() where id = s.id;
end;
$$;
revoke all on function public.recusar_solicitacao(uuid, text) from public;
grant execute on function public.recusar_solicitacao(uuid, text) to authenticated, service_role;

-- Pedido manual criado pelo administrador.
-- p_itens: [{"receita_id": uuid, "quantidade": int, "preco_centavos": int}]
-- p_pagamento: null ou {"valor_centavos": int, "metodo": text, "referencia": text, "recebido_em": timestamptz}
create or replace function public.criar_pedido_manual(
  p_nome         text,
  p_telefone     text,
  p_modalidade   text,
  p_endereco     text,
  p_entrega_em   date,
  p_observacoes  text,
  p_itens        jsonb,
  p_campanha_id  uuid default null,
  p_pagamento    jsonb default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tel text := public.normalizar_telefone(p_telefone);
  v_nome text := trim(coalesce(p_nome, ''));
  v_cliente uuid; v_pedido uuid; v_total integer;
begin
  if not public.pode_administrar() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if length(v_nome) < 2 then raise exception 'Informe o nome do cliente.' using errcode = 'P0001'; end if;
  if length(v_tel) not in (10, 11) then raise exception 'Informe o telefone com DDD.' using errcode = 'P0001'; end if;
  if p_modalidade not in ('entrega','retirada') then raise exception 'Escolha entrega ou retirada.' using errcode = 'P0001'; end if;
  if p_entrega_em is null then raise exception 'Informe a data de entrega.' using errcode = 'P0001'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Adicione ao menos um item.' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(p_itens) e
             where coalesce((e->>'quantidade')::integer, 0) <= 0
                or coalesce((e->>'preco_centavos')::integer, -1) < 0) then
    raise exception 'Quantidades e preços inválidos.' using errcode = 'P0001';
  end if;

  v_cliente := public.upsert_cliente(v_nome, v_tel, p_endereco);

  select sum((e->>'quantidade')::integer * (e->>'preco_centavos')::integer) into v_total
    from jsonb_array_elements(p_itens) e;

  insert into public.pedidos (cliente_id, cliente_nome, cliente_telefone, origem, campanha_id,
                              modalidade, endereco, entrega_em, observacoes, total_centavos, criado_por)
  values (v_cliente, v_nome, v_tel, 'manual', p_campanha_id, p_modalidade,
          case when p_modalidade = 'entrega' then nullif(trim(coalesce(p_endereco, '')), '') end,
          p_entrega_em, nullif(trim(coalesce(p_observacoes, '')), ''), v_total, auth.uid())
  returning id into v_pedido;

  insert into public.pedido_itens (pedido_id, receita_id, receita_versao_id, nome, quantidade, preco_unit_centavos, subtotal_centavos)
  select v_pedido, r.id, r.versao_atual_id, r.nome,
         (e->>'quantidade')::integer, (e->>'preco_centavos')::integer,
         (e->>'quantidade')::integer * (e->>'preco_centavos')::integer
    from jsonb_array_elements(p_itens) e
    join public.receitas r on r.id = (e->>'receita_id')::uuid;
  if (select count(*) from public.pedido_itens where pedido_id = v_pedido) <> jsonb_array_length(p_itens) then
    raise exception 'Receita inválida.' using errcode = 'P0001';
  end if;

  if p_pagamento is not null and coalesce((p_pagamento->>'valor_centavos')::integer, 0) > 0 then
    insert into public.pagamentos (pedido_id, valor_centavos, recebido_em, metodo, referencia, conferido_por)
    values (v_pedido, (p_pagamento->>'valor_centavos')::integer,
            coalesce((p_pagamento->>'recebido_em')::timestamptz, now()),
            coalesce(p_pagamento->>'metodo', 'pix'),
            nullif(trim(coalesce(p_pagamento->>'referencia', '')), ''), auth.uid());
  end if;
  return v_pedido;
end;
$$;
revoke all on function public.criar_pedido_manual(text, text, text, text, date, text, jsonb, uuid, jsonb) from public;
grant execute on function public.criar_pedido_manual(text, text, text, text, date, text, jsonb, uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.campanhas          enable row level security;
alter table public.campanha_produtos  enable row level security;
alter table public.clientes           enable row level security;
alter table public.solicitacoes       enable row level security;
alter table public.solicitacao_itens  enable row level security;
alter table public.comprovantes       enable row level security;
alter table public.conferencias       enable row level security;
alter table public.pedidos            enable row level security;
alter table public.pedido_itens       enable row level security;
alter table public.pagamentos         enable row level security;

create policy adm_all on public.campanhas         for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy adm_all on public.campanha_produtos for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy adm_all on public.clientes          for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy adm_all on public.pedidos           for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy adm_all on public.pedido_itens      for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy adm_all on public.pagamentos        for all to authenticated using (public.is_admin()) with check (public.is_admin());
-- Solicitações, comprovantes e conferências: leitura pelo admin; mudanças só pelas funções acima
create policy adm_read on public.solicitacoes      for select to authenticated using (public.is_admin());
create policy adm_read on public.solicitacao_itens for select to authenticated using (public.is_admin());
create policy adm_read on public.comprovantes      for select to authenticated using (public.is_admin());
create policy adm_read on public.conferencias      for select to authenticated using (public.is_admin());

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;

-- O Supabase concede EXECUTE a anon/authenticated por padrão em funções novas.
-- Aqui fechamos tudo e liberamos só o necessário.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.nova_versao_receita(uuid, numeric, jsonb, text) to authenticated;
grant execute on function public.aprovar_solicitacao(uuid, integer, text, timestamptz) to authenticated;
grant execute on function public.recusar_solicitacao(uuid, text) to authenticated;
grant execute on function public.criar_pedido_manual(text, text, text, text, date, text, jsonb, uuid, jsonb) to authenticated;
grant execute on function public.campanha_pode_vender(uuid) to authenticated;
grant execute on all functions in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Storage privado para comprovantes
-- Bucket não público: só o servidor grava; só o admin lê (via URL assinada de curta duração).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprovantes', 'comprovantes', false, 8388608,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy comprovantes_admin_le on storage.objects for select to authenticated
  using (bucket_id = 'comprovantes' and public.is_admin());
