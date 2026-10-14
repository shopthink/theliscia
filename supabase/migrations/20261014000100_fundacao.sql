-- The Liscia Pizzas · Fundação
-- Administrador, configurações, insumos e receitas versionadas.
-- Valores monetários em centavos (integer). Quantidades físicas em g, ml ou un.

-- gen_random_uuid() é nativo do PostgreSQL 13+; nenhuma extensão é necessária.

-- ---------------------------------------------------------------------------
-- Administrador
-- O proprietário é cadastrado manualmente (ver README, "Definir o administrador").
-- Nenhum visitante consegue se declarar administrador: não há política de insert.
-- ---------------------------------------------------------------------------
create table public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins a
    where a.user_id = auth.uid() and a.ativo
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, service_role;

-- Quem pode executar funções administrativas:
-- o administrador autenticado, o servidor (service_role) ou o proprietário do banco
-- rodando migrações/console SQL. "session_user" não muda dentro de security definer.
create or replace function public.pode_administrar()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
      or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') = 'service_role'
      or session_user in ('postgres', 'supabase_admin');
$$;
revoke all on function public.pode_administrar() from public;

-- Data/hora operacional
create or replace function public.hoje_sp(p_agora timestamptz default now())
returns date
language sql
immutable
as $$ select (p_agora at time zone 'America/Sao_Paulo')::date $$;

-- Atualiza "atualizado_em" e incrementa "versao" (controle de edição em duas abas)
create or replace function public.tg_versionar()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  new.versao := coalesce(old.versao, 0) + 1;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Configurações (linha única)
-- ---------------------------------------------------------------------------
create table public.configuracoes (
  id                      boolean primary key default true check (id),
  nome_comercial          text not null default 'The Liscia Pizzas',
  whatsapp_contato        text,
  email_contato           text,
  instagram               text,
  valor_hora_centavos     integer not null default 0 check (valor_hora_centavos >= 0),
  taxa_percentual         numeric(5,2) not null default 0 check (taxa_percentual between 0 and 100),
  -- Consumos auxiliares (estimativas editáveis, não medições)
  semola_g_por_base       numeric(10,2) not null default 7 check (semola_g_por_base >= 0),
  saco_vacuo_por_base     numeric(10,2) not null default 1 check (saco_vacuo_por_base >= 0),
  etiqueta_por_base       numeric(10,2) not null default 1 check (etiqueta_por_base >= 0),
  molho_ml_por_base       numeric(10,2) not null default 0 check (molho_ml_por_base >= 0),
  sacola_por_pedido       numeric(10,2) not null default 1 check (sacola_por_pedido >= 0),
  moeda                   text not null default 'BRL',
  fuso                    text not null default 'America/Sao_Paulo',
  versao                  integer not null default 1,
  atualizado_em           timestamptz not null default now()
);
create trigger configuracoes_versionar before update on public.configuracoes
  for each row execute function public.tg_versionar();

insert into public.configuracoes (id) values (true);

-- ---------------------------------------------------------------------------
-- Insumos
-- preco_ref_centavos: preço de referência por unidade base (g, ml ou un).
-- É uma estimativa do proprietário. Compras reais substituem no custo (fase 2).
-- ---------------------------------------------------------------------------
create table public.insumos (
  id                   uuid primary key default gen_random_uuid(),
  nome                 text not null unique check (length(trim(nome)) between 1 and 80),
  unidade              text not null check (unidade in ('g','ml','un')),
  categoria            text not null default 'ingrediente' check (categoria in ('ingrediente','embalagem','outro')),
  preco_ref_centavos   numeric(14,6) check (preco_ref_centavos >= 0),
  entra_lista_compras  boolean not null default true,
  observacoes          text,
  ativo                boolean not null default true,
  versao               integer not null default 1,
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now()
);
create trigger insumos_versionar before update on public.insumos
  for each row execute function public.tg_versionar();

insert into public.insumos (nome, unidade, categoria, preco_ref_centavos, entra_lista_compras, observacoes) values
  ('Farinha',                 'g',  'ingrediente', null, true,  null),
  ('Cerveja',                 'ml', 'ingrediente', null, true,  null),
  ('Água filtrada',           'ml', 'ingrediente', 0,    false, 'Custo zero; não entra na lista de compras.'),
  ('Sal',                     'g',  'ingrediente', null, true,  null),
  ('Fermento biológico fresco','g', 'ingrediente', null, true,  null),
  ('Azeite',                  'ml', 'ingrediente', null, true,  null),
  ('Sêmola de abertura',      'g',  'ingrediente', null, true,  'Consumo por base é estimativa até ser medido.'),
  ('Molho de marcação',       'ml', 'ingrediente', null, true,  'Opcional.'),
  ('Saco para vácuo',         'un', 'embalagem',   null, true,  null),
  ('Etiqueta',                'un', 'embalagem',   null, true,  null),
  ('Sacola kraft',            'un', 'embalagem',   null, true,  'Por pedido/entrega, não por pizza.');

-- Impede trocar a unidade de um insumo que já é usado em receitas
create or replace function public.tg_insumo_unidade()
returns trigger
language plpgsql
as $$
begin
  if new.unidade <> old.unidade and exists (
    select 1 from public.receita_versao_ingredientes where insumo_id = old.id
  ) then
    raise exception 'Não é possível trocar a unidade de um insumo com histórico.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Receitas versionadas
-- receitas: identidade (Italiana, NY). receita_versoes: ficha técnica imutável.
-- Editar uma receita cria uma nova versão; pedidos e lotes guardam a versão usada.
-- ---------------------------------------------------------------------------
create table public.receitas (
  id               uuid primary key default gen_random_uuid(),
  codigo           text not null unique check (codigo ~ '^[a-z0-9-]{2,40}$'),
  nome             text not null check (length(trim(nome)) between 1 and 80),
  versao_atual_id  uuid,
  ativa            boolean not null default true,
  criado_em        timestamptz not null default now()
);

create table public.receita_versoes (
  id              uuid primary key default gen_random_uuid(),
  receita_id      uuid not null references public.receitas(id) on delete restrict,
  numero          integer not null check (numero > 0),
  peso_bolinha_g  numeric(10,2) not null check (peso_bolinha_g > 0),
  massa_base_g    numeric(12,3) not null check (massa_base_g > 0),
  observacoes     text,
  criado_em       timestamptz not null default now(),
  criado_por      uuid,
  unique (receita_id, numero)
);

create table public.receita_versao_ingredientes (
  receita_versao_id   uuid not null references public.receita_versoes(id) on delete cascade,
  insumo_id           uuid not null references public.insumos(id) on delete restrict,
  quantidade          numeric(12,3) not null check (quantidade > 0),
  -- gramas por unidade do insumo, para estimar a massa: 1 para g/água/cerveja, 0,91 para azeite
  densidade_g         numeric(8,4) not null default 1 check (densidade_g > 0),
  primary key (receita_versao_id, insumo_id)
);

alter table public.receitas
  add constraint receitas_versao_atual_fk foreign key (versao_atual_id)
  references public.receita_versoes(id) on delete restrict deferrable initially deferred;

create trigger insumos_unidade before update of unidade on public.insumos
  for each row execute function public.tg_insumo_unidade();

-- Cria uma nova versão da receita (atômico). p_ingredientes: [{insumo_id, quantidade, densidade_g}]
create or replace function public.nova_versao_receita(
  p_receita_id     uuid,
  p_peso_bolinha_g numeric,
  p_ingredientes   jsonb,
  p_observacoes    text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero  integer;
  v_id      uuid;
  v_massa   numeric;
begin
  if not public.pode_administrar() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if p_ingredientes is null or jsonb_typeof(p_ingredientes) <> 'array' or jsonb_array_length(p_ingredientes) = 0 then
    raise exception 'Informe ao menos um ingrediente.';
  end if;

  perform 1 from public.receitas where id = p_receita_id for update;
  if not found then raise exception 'Receita não encontrada.'; end if;

  select coalesce(max(numero), 0) + 1 into v_numero
    from public.receita_versoes where receita_id = p_receita_id;

  select sum((e->>'quantidade')::numeric * coalesce((e->>'densidade_g')::numeric, 1))
    into v_massa
    from jsonb_array_elements(p_ingredientes) e;

  insert into public.receita_versoes (receita_id, numero, peso_bolinha_g, massa_base_g, observacoes, criado_por)
  values (p_receita_id, v_numero, p_peso_bolinha_g, v_massa, p_observacoes, auth.uid())
  returning id into v_id;

  insert into public.receita_versao_ingredientes (receita_versao_id, insumo_id, quantidade, densidade_g)
  select v_id, (e->>'insumo_id')::uuid, (e->>'quantidade')::numeric, coalesce((e->>'densidade_g')::numeric, 1)
    from jsonb_array_elements(p_ingredientes) e;

  update public.receitas set versao_atual_id = v_id where id = p_receita_id;
  return v_id;
end;
$$;
revoke all on function public.nova_versao_receita(uuid, numeric, jsonb, text) from public;
grant execute on function public.nova_versao_receita(uuid, numeric, jsonb, text) to authenticated, service_role;

-- Receitas iniciais (fichas técnicas informadas pelo proprietário)
do $$
declare
  v_it uuid; v_ny uuid;
  f uuid; c uuid; a uuid; s uuid; fe uuid; az uuid;
begin
  select id into f  from public.insumos where nome = 'Farinha';
  select id into c  from public.insumos where nome = 'Cerveja';
  select id into a  from public.insumos where nome = 'Água filtrada';
  select id into s  from public.insumos where nome = 'Sal';
  select id into fe from public.insumos where nome = 'Fermento biológico fresco';
  select id into az from public.insumos where nome = 'Azeite';

  insert into public.receitas (codigo, nome) values ('italiana', 'Italiana clássica') returning id into v_it;
  insert into public.receitas (codigo, nome) values ('ny', 'NY style') returning id into v_ny;

  perform public.nova_versao_receita(v_it, 180, jsonb_build_array(
    jsonb_build_object('insumo_id', f,  'quantidade', 500),
    jsonb_build_object('insumo_id', c,  'quantidade', 175),
    jsonb_build_object('insumo_id', a,  'quantidade', 165),
    jsonb_build_object('insumo_id', s,  'quantidade', 15),
    jsonb_build_object('insumo_id', fe, 'quantidade', 2)
  ), 'Receita-base inicial. Borda alta.');

  perform public.nova_versao_receita(v_ny, 180, jsonb_build_array(
    jsonb_build_object('insumo_id', f,  'quantidade', 500),
    jsonb_build_object('insumo_id', c,  'quantidade', 175),
    jsonb_build_object('insumo_id', a,  'quantidade', 125),
    jsonb_build_object('insumo_id', az, 'quantidade', 25, 'densidade_g', 0.91),
    jsonb_build_object('insumo_id', s,  'quantidade', 15),
    jsonb_build_object('insumo_id', fe, 'quantidade', 2)
  ), 'Receita-base inicial.');
end $$;
set constraints all immediate;

-- ---------------------------------------------------------------------------
-- RLS: somente o administrador lê e escreve. Visitantes não têm nenhuma política.
-- ---------------------------------------------------------------------------
alter table public.admins                      enable row level security;
alter table public.configuracoes               enable row level security;
alter table public.insumos                     enable row level security;
alter table public.receitas                    enable row level security;
alter table public.receita_versoes             enable row level security;
alter table public.receita_versao_ingredientes enable row level security;

create policy admins_self on public.admins for select to authenticated using (user_id = auth.uid());

create policy adm_all on public.configuracoes for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy adm_all on public.insumos       for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy adm_all on public.receitas      for all to authenticated using (public.is_admin()) with check (public.is_admin());
-- Versões de receita são imutáveis: só leitura direta; criação via nova_versao_receita()
create policy adm_read on public.receita_versoes             for select to authenticated using (public.is_admin());
create policy adm_read on public.receita_versao_ingredientes for select to authenticated using (public.is_admin());

-- Garantir que o papel anônimo não tenha acesso direto
revoke all on all tables in schema public from anon;
