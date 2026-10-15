-- The Liscia Pizzas · Entrega por condomínio
--
-- * Condomínios parceiros: link próprio (/pedido?c=slug), entrega grátis, cliente informa só bloco e apto.
-- * Meta coletiva opcional por condomínio (bases somadas na campanha).
-- * Entrega fora de condomínio com taxa configurável na campanha (somada ao total e ao Pix).
-- * Retirada continua existindo, mas pode ser desligada na campanha.

create table public.condominios (
  id                   uuid primary key default gen_random_uuid(),
  nome                 text not null check (length(trim(nome)) between 2 and 80),
  slug                 text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 40),
  endereco             text not null check (length(trim(endereco)) between 8 and 300),
  forma_entrega        text not null default 'portaria' check (forma_entrega in ('portaria', 'porta')),
  janela_entrega       text check (janela_entrega is null or length(janela_entrega) <= 120),
  instrucoes_cliente   text check (instrucoes_cliente is null or length(instrucoes_cliente) <= 500),
  notas_internas       text check (notas_internas is null or length(notas_internas) <= 1000),
  meta_bases           integer check (meta_bases between 1 and 500),
  ativo                boolean not null default true,
  versao               integer not null default 1,
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now()
);
create trigger condominios_versionar before update on public.condominios
  for each row execute function public.tg_versionar();

-- Campanha: condomínios ligados ou não, e taxa para entrega em endereço avulso
alter table public.campanhas
  add column permite_condominios    boolean not null default true,
  add column taxa_entrega_centavos  integer not null default 0 check (taxa_entrega_centavos between 0 and 100000);
alter table public.campanhas drop constraint campanha_modalidade;
alter table public.campanhas
  add constraint campanha_modalidade check (permite_entrega or permite_retirada or permite_condominios);

-- Cliente lembra o último condomínio, bloco e apto
alter table public.clientes
  add column condominio_id uuid references public.condominios(id) on delete set null,
  add column bloco         text,
  add column apto          text;

-- Solicitação e pedido guardam o que o cliente viu (nome do condomínio, taxa)
alter table public.solicitacoes
  add column condominio_id          uuid references public.condominios(id) on delete restrict,
  add column condominio_nome        text,
  add column bloco                  text,
  add column apto                   text,
  add column taxa_entrega_centavos  integer not null default 0 check (taxa_entrega_centavos >= 0),
  add constraint solicitacao_condominio check (condominio_id is null or modalidade = 'entrega');
alter table public.pedidos
  add column condominio_id          uuid references public.condominios(id) on delete restrict,
  add column condominio_nome        text,
  add column bloco                  text,
  add column apto                   text,
  add column taxa_entrega_centavos  integer not null default 0 check (taxa_entrega_centavos >= 0),
  add constraint pedido_condominio check (condominio_id is null or modalidade = 'entrega');
create index on public.solicitacoes (condominio_id, campanha_id);
create index on public.pedidos (condominio_id, campanha_id);

-- ---------------------------------------------------------------------------
-- Cliente
-- ---------------------------------------------------------------------------
drop function public.upsert_cliente(text, text, text);
create function public.upsert_cliente(
  p_nome text, p_telefone text, p_endereco text,
  p_condominio_id uuid default null, p_bloco text default null, p_apto text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  insert into public.clientes (nome, telefone, endereco, condominio_id, bloco, apto)
  values (p_nome, p_telefone, nullif(trim(coalesce(p_endereco, '')), ''), p_condominio_id,
          nullif(trim(coalesce(p_bloco, '')), ''), nullif(trim(coalesce(p_apto, '')), ''))
  on conflict (telefone) do update set
    nome = excluded.nome,
    endereco = coalesce(excluded.endereco, public.clientes.endereco),
    condominio_id = coalesce(excluded.condominio_id, public.clientes.condominio_id),
    bloco = case when excluded.condominio_id is not null then excluded.bloco else public.clientes.bloco end,
    apto  = case when excluded.condominio_id is not null then excluded.apto  else public.clientes.apto  end,
    atualizado_em = now()
  returning id into v_id;
  return v_id;
end;
$$;

-- Bases já garantidas de um condomínio numa campanha (pedidos não cancelados + comprovantes em conferência)
create or replace function public.bases_condominio(p_condominio_id uuid, p_campanha_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (
    coalesce((select sum(i.quantidade) from public.pedidos p join public.pedido_itens i on i.pedido_id = p.id
               where p.condominio_id = p_condominio_id and p.campanha_id = p_campanha_id
                 and p.status_producao <> 'cancelado'), 0)
    + coalesce((select sum(s.total_bases) from public.solicitacoes s
                 where s.condominio_id = p_condominio_id and s.campanha_id = p_campanha_id
                   and s.status = 'em_conferencia'), 0)
  )::integer;
$$;

-- ---------------------------------------------------------------------------
-- Solicitação pública
-- p_condominio_id preenchido = entrega no condomínio (grátis, pede bloco/apto).
-- Entrega sem condomínio soma a taxa da campanha.
-- ---------------------------------------------------------------------------
drop function public.criar_solicitacao(jsonb, text, text, text, text, text, text, timestamptz);
create function public.criar_solicitacao(
  p_itens          jsonb,
  p_nome           text,
  p_telefone       text,
  p_modalidade     text,
  p_endereco       text,
  p_observacoes    text,
  p_origem_hash    text default null,
  p_agora          timestamptz default now(),
  p_condominio_id  uuid default null,
  p_bloco          text default null,
  p_apto           text default null
) returns table (id uuid, token text, numero integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  c            public.campanhas%rowtype;
  co           public.condominios%rowtype;
  v_nome       text := trim(coalesce(p_nome, ''));
  v_tel        text := public.normalizar_telefone(p_telefone);
  v_end        text := nullif(trim(coalesce(p_endereco, '')), '');
  v_obs        text := nullif(trim(coalesce(p_observacoes, '')), '');
  v_bloco      text := nullif(trim(coalesce(p_bloco, '')), '');
  v_apto       text := nullif(trim(coalesce(p_apto, '')), '');
  v_mod        text := p_modalidade;
  v_taxa       integer := 0;
  v_itens      integer := 0;
  v_total      integer := 0;
  v_bases      integer := 0;
  v_sinal      integer;
  v_cliente    uuid;
  v_id         uuid;
  v_token      text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_numero     integer;
  v_item       record;
  v_count      integer;
begin
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

  if p_condominio_id is not null then
    select * into co from public.condominios where condominios.id = p_condominio_id and ativo;
    if not found or not c.permite_condominios then
      raise exception 'Este condomínio não está recebendo pedidos agora.' using errcode = 'P0001';
    end if;
    if v_apto is null then
      raise exception 'Informe o apartamento ou a casa.' using errcode = 'P0001';
    end if;
    if length(coalesce(v_bloco, '')) > 20 or length(v_apto) > 20 then
      raise exception 'Bloco e apartamento muito longos.' using errcode = 'P0001';
    end if;
    v_mod := 'entrega';
    v_end := co.endereco;
  else
    v_bloco := null; v_apto := null;
    if v_mod not in ('entrega', 'retirada')
       or (v_mod = 'entrega' and not c.permite_entrega)
       or (v_mod = 'retirada' and not c.permite_retirada) then
      raise exception 'Escolha como quer receber.' using errcode = 'P0001';
    end if;
    if v_mod = 'entrega' then
      if v_end is null or length(v_end) < 8 then
        raise exception 'Informe o endereço de entrega.' using errcode = 'P0001';
      end if;
      v_taxa := c.taxa_entrega_centavos;
    end if;
  end if;
  if length(coalesce(v_end, '')) > 300 or length(coalesce(v_obs, '')) > 500 then
    raise exception 'Texto muito longo.' using errcode = 'P0001';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0
     or jsonb_array_length(p_itens) > 20 then
    raise exception 'Escolha ao menos um produto.' using errcode = 'P0001';
  end if;

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

  select coalesce(sum(t.quantidade), 0), coalesce(sum(t.quantidade * t.preco), 0)
    into v_bases, v_itens from _itens_sol t;

  if v_bases = 0 then
    raise exception 'Escolha ao menos um produto.' using errcode = 'P0001';
  end if;
  if v_bases < c.pedido_minimo then
    raise exception 'O pedido mínimo é de % bases.', c.pedido_minimo using errcode = 'P0001';
  end if;
  if v_bases > 300 then
    raise exception 'Para pedidos grandes, fale com a gente pelo WhatsApp.' using errcode = 'P0001';
  end if;

  v_total := v_itens + v_taxa;
  v_sinal := round(v_total * c.percentual_sinal / 100.0)::integer;
  v_cliente := public.upsert_cliente(v_nome, v_tel, case when p_condominio_id is null then v_end end,
                                     p_condominio_id, v_bloco, v_apto);

  insert into public.solicitacoes (
    token, campanha_id, campanha_nome, cliente_id, cliente_nome, cliente_telefone,
    modalidade, endereco, observacoes, entrega_em, pix_chave, pix_favorecido, pix_cidade,
    percentual_sinal, total_centavos, sinal_centavos, saldo_centavos, total_bases,
    comprovante_ate, origem_hash, criado_em,
    condominio_id, condominio_nome, bloco, apto, taxa_entrega_centavos
  ) values (
    v_token, c.id, c.nome, v_cliente, v_nome, v_tel,
    v_mod, case when v_mod = 'entrega' then v_end else null end, v_obs,
    c.entrega_em, trim(c.pix_chave), trim(c.pix_favorecido), c.pix_cidade,
    c.percentual_sinal, v_total, v_sinal, v_total - v_sinal, v_bases,
    p_agora + make_interval(hours => c.horas_envio_comprovante), p_origem_hash, p_agora,
    p_condominio_id, co.nome, v_bloco, v_apto, v_taxa
  ) returning solicitacoes.id, solicitacoes.numero into v_id, v_numero;

  insert into public.solicitacao_itens (solicitacao_id, campanha_produto_id, receita_id, receita_versao_id,
                                        nome, quantidade, preco_unit_centavos, subtotal_centavos)
  select v_id, t.produto_id, t.receita_id, t.receita_versao_id, t.nome, sum(t.quantidade), t.preco, sum(t.quantidade) * t.preco
    from _itens_sol t
   group by t.produto_id, t.receita_id, t.receita_versao_id, t.nome, t.preco;

  return query select v_id, v_token, v_numero;
end;
$$;

-- Aprovação copia condomínio, bloco, apto e taxa para o pedido
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
    modalidade, endereco, entrega_em, observacoes, total_centavos, criado_por,
    condominio_id, condominio_nome, bloco, apto, taxa_entrega_centavos
  ) values (
    s.cliente_id, s.cliente_nome, s.cliente_telefone, 'link', s.campanha_id, s.id,
    s.modalidade, s.endereco, s.entrega_em, s.observacoes, s.total_centavos, auth.uid(),
    s.condominio_id, s.condominio_nome, s.bloco, s.apto, s.taxa_entrega_centavos
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

-- Pedido manual com condomínio e taxa
drop function public.criar_pedido_manual(text, text, text, text, date, text, jsonb, uuid, jsonb);
create function public.criar_pedido_manual(
  p_nome           text,
  p_telefone       text,
  p_modalidade     text,
  p_endereco       text,
  p_entrega_em     date,
  p_observacoes    text,
  p_itens          jsonb,
  p_campanha_id    uuid default null,
  p_pagamento      jsonb default null,
  p_condominio_id  uuid default null,
  p_bloco          text default null,
  p_apto           text default null,
  p_taxa_entrega_centavos integer default 0
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tel text := public.normalizar_telefone(p_telefone);
  v_nome text := trim(coalesce(p_nome, ''));
  v_mod text := p_modalidade;
  v_end text := nullif(trim(coalesce(p_endereco, '')), '');
  v_bloco text := nullif(trim(coalesce(p_bloco, '')), '');
  v_apto text := nullif(trim(coalesce(p_apto, '')), '');
  v_taxa integer := coalesce(p_taxa_entrega_centavos, 0);
  co public.condominios%rowtype;
  v_cliente uuid; v_pedido uuid; v_total integer;
begin
  if not public.pode_administrar() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if length(v_nome) < 2 then raise exception 'Informe o nome do cliente.' using errcode = 'P0001'; end if;
  if length(v_tel) not in (10, 11) then raise exception 'Informe o telefone com DDD.' using errcode = 'P0001'; end if;
  if p_condominio_id is not null then
    select * into co from public.condominios where id = p_condominio_id;
    if not found then raise exception 'Condomínio não encontrado.' using errcode = 'P0001'; end if;
    if v_apto is null then raise exception 'Informe o apartamento ou a casa.' using errcode = 'P0001'; end if;
    v_mod := 'entrega';
    v_end := co.endereco;
  else
    v_bloco := null; v_apto := null;
    if v_mod not in ('entrega','retirada') then raise exception 'Escolha como o cliente recebe.' using errcode = 'P0001'; end if;
  end if;
  if v_mod = 'retirada' then v_taxa := 0; end if;
  if v_taxa < 0 or v_taxa > 100000 then raise exception 'Taxa de entrega inválida.' using errcode = 'P0001'; end if;
  if p_entrega_em is null then raise exception 'Informe a data de entrega.' using errcode = 'P0001'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Adicione ao menos um item.' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(p_itens) e
             where coalesce((e->>'quantidade')::integer, 0) <= 0
                or coalesce((e->>'preco_centavos')::integer, -1) < 0) then
    raise exception 'Quantidades e preços inválidos.' using errcode = 'P0001';
  end if;

  v_cliente := public.upsert_cliente(v_nome, v_tel, case when p_condominio_id is null then v_end end,
                                     p_condominio_id, v_bloco, v_apto);

  select sum((e->>'quantidade')::integer * (e->>'preco_centavos')::integer) into v_total
    from jsonb_array_elements(p_itens) e;
  v_total := v_total + v_taxa;

  insert into public.pedidos (cliente_id, cliente_nome, cliente_telefone, origem, campanha_id,
                              modalidade, endereco, entrega_em, observacoes, total_centavos, criado_por,
                              condominio_id, condominio_nome, bloco, apto, taxa_entrega_centavos)
  values (v_cliente, v_nome, v_tel, 'manual', p_campanha_id, v_mod,
          case when v_mod = 'entrega' then v_end end,
          p_entrega_em, nullif(trim(coalesce(p_observacoes, '')), ''), v_total, auth.uid(),
          p_condominio_id, co.nome, v_bloco, v_apto, v_taxa)
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

-- ---------------------------------------------------------------------------
-- Segurança
-- ---------------------------------------------------------------------------
alter table public.condominios enable row level security;
create policy adm_all on public.condominios for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.condominios from anon;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.nova_versao_receita(uuid, numeric, jsonb, text, numeric) to authenticated;
grant execute on function public.aprovar_solicitacao(uuid, integer, text, timestamptz) to authenticated;
grant execute on function public.recusar_solicitacao(uuid, text) to authenticated;
grant execute on function public.criar_pedido_manual(text, text, text, text, date, text, jsonb, uuid, jsonb, uuid, text, text, integer) to authenticated;
grant execute on function public.campanha_pode_vender(uuid) to authenticated;
grant execute on function public.bases_condominio(uuid, uuid) to authenticated;
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
