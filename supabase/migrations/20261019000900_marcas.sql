-- The Liscia Pizzas · Marcas dos insumos
--
-- * O insumo continua genérico na receita ("Farinha"). A marca é o produto comprado ("Caputo Pizzeria").
-- * Cada marca tem tabela nutricional, nome para o rótulo, embalagens e notas de qualidade.
-- * Estoque separado por marca: saldo e custo médio por (insumo, marca). "Sem marca" = marca nula.
-- * Compras e lotes registram a marca. O lote começa com a marca "em uso" de cada insumo.
-- * Rótulo validado por combinação de marcas: cada combinação tem sua tabela nutricional e lista de ingredientes.

-- ---------------------------------------------------------------------------
-- Marcas
-- ---------------------------------------------------------------------------
create table public.marcas (
  id                       uuid primary key default gen_random_uuid(),
  insumo_id                uuid not null references public.insumos(id) on delete cascade,
  nome                     text not null check (length(trim(nome)) between 1 and 80),
  nome_rotulo              text check (nome_rotulo is null or length(nome_rotulo) <= 200),
  notas                    text check (notas is null or length(notas) <= 2000),
  em_uso                   boolean not null default false,
  ativo                    boolean not null default true,
  nutri_kcal               numeric(8,2) check (nutri_kcal >= 0),
  nutri_carboidratos_g     numeric(8,2) check (nutri_carboidratos_g >= 0),
  nutri_acucares_totais_g  numeric(8,2) check (nutri_acucares_totais_g >= 0),
  nutri_acucares_adic_g    numeric(8,2) check (nutri_acucares_adic_g >= 0),
  nutri_proteinas_g        numeric(8,2) check (nutri_proteinas_g >= 0),
  nutri_gorduras_g         numeric(8,2) check (nutri_gorduras_g >= 0),
  nutri_saturadas_g        numeric(8,2) check (nutri_saturadas_g >= 0),
  nutri_trans_g            numeric(8,2) check (nutri_trans_g >= 0),
  nutri_fibras_g           numeric(8,2) check (nutri_fibras_g >= 0),
  nutri_sodio_mg           numeric(10,2) check (nutri_sodio_mg >= 0),
  nutri_fonte              text,
  versao                   integer not null default 1,
  criado_em                timestamptz not null default now(),
  atualizado_em            timestamptz not null default now()
);
create unique index marcas_nome_unico on public.marcas (insumo_id, (lower(trim(nome))));
create unique index marcas_uma_em_uso on public.marcas (insumo_id) where em_uso;
create trigger marcas_versionar before update on public.marcas
  for each row execute function public.tg_versionar();

-- Marca precisa ser do mesmo insumo (usado em embalagens, compras, movimentos e lotes)
create or replace function public.marca_do_insumo(p_marca_id uuid, p_insumo_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select p_marca_id is null or exists (select 1 from public.marcas where id = p_marca_id and insumo_id = p_insumo_id);
$$;

-- Marca em uso (uma por insumo), trocando de forma atômica
create or replace function public.definir_marca_em_uso(p_marca_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_insumo uuid;
begin
  if not public.pode_administrar() then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  select insumo_id into v_insumo from public.marcas where id = p_marca_id;
  if not found then raise exception 'Marca não encontrada.' using errcode = 'P0001'; end if;
  update public.marcas set em_uso = false where insumo_id = v_insumo and em_uso and id <> p_marca_id;
  update public.marcas set em_uso = true, ativo = true where id = p_marca_id and not em_uso;
end;
$$;

-- ---------------------------------------------------------------------------
-- Embalagens por marca
-- ---------------------------------------------------------------------------
alter table public.insumo_embalagens add column marca_id uuid references public.marcas(id) on delete cascade;
alter table public.insumo_embalagens drop constraint insumo_embalagens_insumo_id_conteudo_unidade_key;
alter table public.insumo_embalagens
  add constraint insumo_embalagens_unica unique nulls not distinct (insumo_id, marca_id, conteudo, unidade),
  add constraint insumo_embalagens_marca check (public.marca_do_insumo(marca_id, insumo_id));

-- ---------------------------------------------------------------------------
-- Compras, movimentos e saldos com marca
-- ---------------------------------------------------------------------------
alter table public.compra_itens
  add column marca_id uuid references public.marcas(id) on delete restrict,
  add constraint compra_itens_marca check (public.marca_do_insumo(marca_id, insumo_id));
alter table public.estoque_movimentos
  add column marca_id uuid references public.marcas(id) on delete restrict,
  add constraint estoque_movimentos_marca check (public.marca_do_insumo(marca_id, insumo_id));
create index on public.estoque_movimentos (insumo_id, marca_id, criado_em);

alter table public.estoque_saldos drop constraint estoque_saldos_pkey;
alter table public.estoque_saldos
  add column id uuid not null default gen_random_uuid(),
  add column marca_id uuid references public.marcas(id) on delete restrict;
alter table public.estoque_saldos
  add primary key (id),
  add constraint estoque_saldos_unico unique nulls not distinct (insumo_id, marca_id);

create or replace function public.tg_estoque_saldo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.estoque_saldos (insumo_id, marca_id, quantidade, valor_centavos)
  values (new.insumo_id, new.marca_id, new.quantidade, new.valor_centavos)
  on conflict (insumo_id, marca_id) do update set
    quantidade = public.estoque_saldos.quantidade + excluded.quantidade,
    valor_centavos = case
      when public.estoque_saldos.quantidade + excluded.quantidade = 0 then 0
      else public.estoque_saldos.valor_centavos + excluded.valor_centavos end,
    atualizado_em = now();
  return null;
end;
$$;

-- Custo médio do insumo somando todas as marcas (referência geral)
create or replace function public.custo_unitario_atual(p_insumo_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select sum(s.valor_centavos) / sum(s.quantidade) from public.estoque_saldos s
      where s.insumo_id = p_insumo_id and s.quantidade > 0 and s.valor_centavos >= 0
     having sum(s.quantidade) > 0),
    (select i.preco_ref_centavos from public.insumos i where i.id = p_insumo_id),
    0);
$$;

-- Custo médio de uma marca; sem saldo dela, o último preço pago por ela; depois o geral do insumo
create or replace function public.custo_unitario_marca(p_insumo_id uuid, p_marca_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.valor_centavos / s.quantidade from public.estoque_saldos s
      where s.insumo_id = p_insumo_id and s.marca_id is not distinct from p_marca_id
        and s.quantidade > 0 and s.valor_centavos >= 0),
    (select ci.custo_final_centavos / ci.quantidade_base from public.compra_itens ci
       join public.compras c on c.id = ci.compra_id
      where ci.insumo_id = p_insumo_id and ci.marca_id is not distinct from p_marca_id and not c.cancelada
      order by c.data desc, c.criado_em desc limit 1),
    public.custo_unitario_atual(p_insumo_id));
$$;

create or replace function public.estornar_compra_no_estoque(p_compra_id uuid, p_data date, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.estoque_movimentos (insumo_id, marca_id, tipo, quantidade, valor_centavos, data, compra_id, motivo, criado_por)
  select m.insumo_id, m.marca_id, 'estorno', -sum(m.quantidade), -sum(m.valor_centavos), p_data, p_compra_id, p_motivo, auth.uid()
    from public.estoque_movimentos m
   where m.compra_id = p_compra_id
   group by m.insumo_id, m.marca_id
  having sum(m.quantidade) <> 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- Salvar compra com marca por item
-- itens: [{insumo_id, marca_id? | marca_nome?, usar_marca?, descricao_original?, pacotes, conteudo, unidade_conteudo, valor_linha_centavos}]
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
  v_marca       uuid;
  v_marca_nome  text;
begin
  if not public.pode_administrar() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

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

  for i in 1..v_n loop
    e := v_itens->(i - 1);
    select * into v_ins from public.insumos where id = nullif(e->>'insumo_id', '')::uuid;
    if not found then raise exception 'Item %: escolha o insumo.', i using errcode = 'P0001'; end if;

    -- Marca: escolhida, digitada (cria na hora) ou nenhuma
    v_marca := nullif(e->>'marca_id', '')::uuid;
    v_marca_nome := nullif(trim(coalesce(e->>'marca_nome', '')), '');
    if v_marca is not null then
      if not exists (select 1 from public.marcas where id = v_marca and insumo_id = v_ins.id) then
        raise exception 'Item % (%): a marca escolhida não é deste insumo.', i, v_ins.nome using errcode = 'P0001';
      end if;
    elsif v_marca_nome is not null then
      if length(v_marca_nome) > 80 then raise exception 'Item %: nome da marca muito longo.', i using errcode = 'P0001'; end if;
      insert into public.marcas (insumo_id, nome) values (v_ins.id, v_marca_nome)
        on conflict (insumo_id, (lower(trim(nome)))) do update set ativo = true
        returning id into v_marca;
    end if;
    if v_marca is not null and coalesce((e->>'usar_marca')::boolean, false) then
      update public.marcas set em_uso = false where insumo_id = v_ins.id and em_uso and id <> v_marca;
      update public.marcas set em_uso = true where id = v_marca and not em_uso;
    end if;

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

    insert into public.compra_itens (compra_id, ordem, insumo_id, marca_id, descricao_original, pacotes, conteudo, unidade_conteudo,
                                     quantidade_base, valor_linha_centavos, rateio_centavos, custo_final_centavos)
    values (v_id, i, v_ins.id, v_marca, nullif(trim(coalesce(e->>'descricao_original', '')), ''),
            (e->>'pacotes')::numeric, (e->>'conteudo')::numeric, v_un,
            v_qtd, v_vals[i], v_parc[i], v_final);

    insert into public.estoque_movimentos (insumo_id, marca_id, tipo, quantidade, valor_centavos, data, compra_id, criado_por)
    values (v_ins.id, v_marca, 'compra', v_qtd, v_final, v_data, v_id, auth.uid());
  end loop;

  return v_id;
end;
$$;

-- Ajuste e perda por marca
drop function public.registrar_ajuste_estoque(uuid, numeric, text, text, date);
create function public.registrar_ajuste_estoque(
  p_insumo_id uuid, p_quantidade numeric, p_tipo text, p_motivo text, p_data date default null, p_marca_id uuid default null
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
  if not public.marca_do_insumo(p_marca_id, p_insumo_id) then
    raise exception 'A marca não é deste insumo.' using errcode = 'P0001';
  end if;
  perform 1 from public.estoque_saldos where insumo_id = p_insumo_id and marca_id is not distinct from p_marca_id for update;
  v_custo := public.custo_unitario_marca(p_insumo_id, p_marca_id);
  insert into public.estoque_movimentos (insumo_id, marca_id, tipo, quantidade, valor_centavos, data, motivo, criado_por)
  values (p_insumo_id, p_marca_id, p_tipo, p_quantidade, round(p_quantidade * v_custo, 4),
          coalesce(p_data, public.hoje_sp()), trim(p_motivo), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lotes: marca usada em cada insumo
-- ---------------------------------------------------------------------------
alter table public.lote_consumos
  add column marca_id uuid references public.marcas(id) on delete restrict,
  add constraint lote_consumos_marca check (public.marca_do_insumo(marca_id, insumo_id));

-- Ao planejar o lote, cada insumo começa com a marca em uso (o apontamento pode trocar)
create or replace function public.tg_consumo_marca_padrao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.marca_id is null and coalesce(current_setting('liscia.marca_explicita', true), '') <> 'on' then
    select id into new.marca_id from public.marcas where insumo_id = new.insumo_id and em_uso;
  end if;
  return new;
end;
$$;
create trigger lote_consumos_marca before insert on public.lote_consumos
  for each row execute function public.tg_consumo_marca_padrao();

-- consumos: [{insumo_id, quantidade_real, marca_id}]
create or replace function public.salvar_apontamento_lote(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare l public.lotes%rowtype; e jsonb; v_marca uuid;
begin
  l := public.lote_editavel((p->>'id')::uuid);
  if p ? 'versao' and (p->>'versao')::integer <> l.versao then
    raise exception 'Este lote foi alterado em outra aba ou dispositivo. Recarregue a página.' using errcode = 'P0001';
  end if;
  perform set_config('liscia.marca_explicita', 'on', true);
  for e in select * from jsonb_array_elements(coalesce(p->'consumos', '[]'::jsonb)) loop
    if coalesce((e->>'quantidade_real')::numeric, -1) < 0 then
      raise exception 'Consumo inválido.' using errcode = 'P0001';
    end if;
    v_marca := nullif(e->>'marca_id', '')::uuid;
    if not public.marca_do_insumo(v_marca, (e->>'insumo_id')::uuid) then
      raise exception 'A marca escolhida não é do insumo.' using errcode = 'P0001';
    end if;
    insert into public.lote_consumos (lote_id, insumo_id, quantidade_prevista, quantidade_real, marca_id)
    values (l.id, (e->>'insumo_id')::uuid, 0, (e->>'quantidade_real')::numeric, v_marca)
    on conflict (lote_id, insumo_id) do update set
      quantidade_real = excluded.quantidade_real,
      marca_id = case when e ? 'marca_id' then excluded.marca_id else public.lote_consumos.marca_id end;
  end loop;
  perform set_config('liscia.marca_explicita', '', true);
  delete from public.lote_consumos where lote_id = l.id and quantidade_prevista = 0 and quantidade_real = 0;
  update public.lotes set
    unidades_boas = case when p ? 'unidades_boas' then nullif(p->>'unidades_boas', '')::integer else unidades_boas end,
    perdas = case when p ? 'perdas' then coalesce(nullif(p->>'perdas', '')::integer, 0) else perdas end,
    quantidade_produzida = case when p ? 'quantidade_produzida' then nullif(p->>'quantidade_produzida', '')::numeric else quantidade_produzida end,
    observacoes = case when p ? 'observacoes' then nullif(trim(p->>'observacoes'), '') else observacoes end
  where id = l.id;
end;
$$;

-- Conclusão: baixa cada insumo da marca usada, pelo custo médio dela
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

  update public.lote_esperas set fim = greatest(now(), inicio) where lote_id = l.id and fim is null;

  for cons in select * from public.lote_consumos where lote_id = l.id and quantidade_real > 0 loop
    perform 1 from public.estoque_saldos where insumo_id = cons.insumo_id and marca_id is not distinct from cons.marca_id for update;
    v_custo := public.custo_unitario_marca(cons.insumo_id, cons.marca_id);
    update public.lote_consumos set custo_unitario_centavos = v_custo,
           custo_total_centavos = round(cons.quantidade_real * v_custo, 4)
     where lote_id = l.id and insumo_id = cons.insumo_id;
    v_mat := v_mat + round(cons.quantidade_real * v_custo, 4);
    insert into public.estoque_movimentos (insumo_id, marca_id, tipo, quantidade, valor_centavos, data, lote_id, motivo, criado_por)
    values (cons.insumo_id, cons.marca_id, 'producao', -cons.quantidade_real, -round(cons.quantidade_real * v_custo, 4),
            coalesce(l.produzido_em, public.hoje_sp()), l.id, 'Lote L-' || lpad(l.numero::text, 4, '0'), auth.uid());
  end loop;

  select coalesce(sum(extract(epoch from (fim - inicio))) / 60.0, 0) into v_min
    from public.lote_sessoes where lote_id = l.id;
  select valor_hora_centavos into v_hora from public.configuracoes limit 1;
  v_mo := round(v_min * v_hora / 60.0)::integer;

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

  update public.pedidos pd set status_producao = 'pronto'
   where pd.id in (select pedido_id from public.pedido_itens where lote_id = l.id)
     and pd.status_producao in ('confirmado', 'em_producao')
     and not exists (select 1 from public.pedido_itens i left join public.lotes lt on lt.id = i.lote_id
                      where i.pedido_id = pd.id and (lt.id is null or lt.status <> 'concluido'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Rótulo por combinação de marcas
-- marcas: {"<insumo_id>": "<marca_id>" | null} para os ingredientes da receita
-- chave: "insumo:marca|insumo:-" em ordem (igual a lib/marcas.ts chaveMarcas)
-- ---------------------------------------------------------------------------
create or replace function public.chave_marcas(p jsonb)
returns text
language sql
immutable
as $$
  select coalesce(string_agg(k || ':' || coalesce(nullif(p->>k, ''), '-'), '|' order by k collate "C"), '')
    from jsonb_object_keys(coalesce(p, '{}'::jsonb)) k;
$$;

create table public.receita_tabelas (
  id                  uuid primary key default gen_random_uuid(),
  receita_id          uuid not null references public.receitas(id) on delete cascade,
  marcas              jsonb not null default '{}',
  chave               text generated always as (public.chave_marcas(marcas)) stored,
  nutricao            jsonb not null,
  ingredientes        text not null check (length(trim(ingredientes)) between 3 and 1000),
  receita_versao_id   uuid references public.receita_versoes(id) on delete set null,
  validada_em         timestamptz not null default now(),
  validada_por        uuid,
  unique (receita_id, chave)
);

-- A tabela que já estava validada vira a da combinação "sem marca"
insert into public.receita_tabelas (receita_id, marcas, nutricao, ingredientes, receita_versao_id, validada_em, validada_por)
select r.id,
       coalesce((select jsonb_object_agg(g.insumo_id::text, null)
                   from public.receita_versao_ingredientes g where g.receita_versao_id = r.versao_atual_id), '{}'::jsonb),
       r.nutricao,
       coalesce(nullif(trim(r.rotulo_ingredientes), ''), r.nome),
       r.nutricao_versao_id, coalesce(r.nutricao_validada_em, now()), r.nutricao_validada_por
  from public.receitas r
 where r.nutricao is not null;

drop function public.validar_nutricao(uuid, jsonb);
create function public.validar_nutricao(p_receita_id uuid, p_valores jsonb, p_marcas jsonb default '{}', p_ingredientes text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare k text; r public.receitas%rowtype; v_id uuid; v_ing text := nullif(trim(coalesce(p_ingredientes, '')), '');
begin
  if not public.pode_administrar() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  select * into r from public.receitas where id = p_receita_id;
  if not found then raise exception 'Receita não encontrada.' using errcode = 'P0001'; end if;
  foreach k in array array['kcal','carboidratos_g','acucares_totais_g','acucares_adic_g','proteinas_g','gorduras_g','saturadas_g','trans_g','fibras_g','sodio_mg'] loop
    if not (p_valores ? k) or (p_valores->>k) is null or (p_valores->>k)::numeric < 0 then
      raise exception 'Preencha todos os valores da tabela (%).', k using errcode = 'P0001';
    end if;
  end loop;
  if v_ing is null or length(v_ing) < 3 then
    raise exception 'Preencha a lista de ingredientes do rótulo.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_marcas, '{}'::jsonb)) <> 'object' then
    raise exception 'Combinação de marcas inválida.' using errcode = 'P0001';
  end if;
  for k in select jsonb_object_keys(p_marcas) loop
    if not public.marca_do_insumo(nullif(p_marcas->>k, '')::uuid, k::uuid) then
      raise exception 'Marca inválida na combinação.' using errcode = 'P0001';
    end if;
  end loop;
  insert into public.receita_tabelas (receita_id, marcas, nutricao, ingredientes, receita_versao_id, validada_por)
  values (r.id, p_marcas, p_valores, v_ing, r.versao_atual_id, auth.uid())
  on conflict (receita_id, chave) do update set
    nutricao = excluded.nutricao, ingredientes = excluded.ingredientes,
    receita_versao_id = excluded.receita_versao_id, validada_em = now(), validada_por = excluded.validada_por
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Comparativo por marca: preço pago, compras, lotes e perdas
-- ---------------------------------------------------------------------------
create or replace view public.marcas_resumo
with (security_invoker = true) as
select m.id, m.insumo_id, m.nome, m.em_uso, m.ativo,
       cp.compras, cp.quantidade_comprada, cp.custo_medio_centavos, cp.ultima_compra_em,
       (select ci.custo_final_centavos / ci.quantidade_base from public.compra_itens ci join public.compras c on c.id = ci.compra_id
         where ci.marca_id = m.id and not c.cancelada order by c.data desc, c.criado_em desc limit 1) as ultimo_custo_centavos,
       (select f.nome from public.compra_itens ci join public.compras c on c.id = ci.compra_id join public.fornecedores f on f.id = c.fornecedor_id
         where ci.marca_id = m.id and not c.cancelada order by c.data desc, c.criado_em desc limit 1) as ultimo_fornecedor,
       coalesce(s.quantidade, 0) as estoque,
       lt.lotes, lt.bases_boas, lt.perdas
  from public.marcas m
  left join (select ci.marca_id, count(distinct c.id)::integer as compras, sum(ci.quantidade_base) as quantidade_comprada,
                    sum(ci.custo_final_centavos) / nullif(sum(ci.quantidade_base), 0) as custo_medio_centavos,
                    max(c.data) as ultima_compra_em
               from public.compra_itens ci join public.compras c on c.id = ci.compra_id
              where not c.cancelada and ci.marca_id is not null
              group by ci.marca_id) cp on cp.marca_id = m.id
  left join public.estoque_saldos s on s.marca_id = m.id
  left join (select lc.marca_id, count(*)::integer as lotes,
                    sum(lo.unidades_boas)::integer as bases_boas, sum(lo.perdas)::integer as perdas
               from public.lote_consumos lc join public.lotes lo on lo.id = lc.lote_id
              where lo.status = 'concluido' and lo.tipo = 'base' and lc.marca_id is not null and lc.quantidade_real > 0
              group by lc.marca_id) lt on lt.marca_id = m.id;

-- ---------------------------------------------------------------------------
-- Segurança
-- ---------------------------------------------------------------------------
alter table public.marcas          enable row level security;
alter table public.receita_tabelas enable row level security;
create policy adm_all  on public.marcas          for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy adm_read on public.receita_tabelas for select to authenticated using (public.is_admin());
revoke all on public.marcas, public.receita_tabelas, public.marcas_resumo from anon;
grant select on public.marcas_resumo to authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.marca_do_insumo(uuid, uuid) to authenticated;
grant execute on function public.chave_marcas(jsonb) to authenticated;
grant execute on function public.definir_marca_em_uso(uuid) to authenticated;
grant execute on function public.nova_versao_receita(uuid, numeric, jsonb, text, numeric) to authenticated;
grant execute on function public.aprovar_solicitacao(uuid, integer, text, timestamptz) to authenticated;
grant execute on function public.recusar_solicitacao(uuid, text) to authenticated;
grant execute on function public.criar_pedido_manual(text, text, text, text, date, text, jsonb, uuid, jsonb, uuid, text, text, integer) to authenticated;
grant execute on function public.campanha_pode_vender(uuid) to authenticated;
grant execute on function public.bases_condominio(uuid, uuid) to authenticated;
grant execute on function public.salvar_compra(jsonb) to authenticated;
grant execute on function public.excluir_compra(uuid, text) to authenticated;
grant execute on function public.registrar_ajuste_estoque(uuid, numeric, text, text, date, uuid) to authenticated;
grant execute on function public.custo_unitario_atual(uuid) to authenticated;
grant execute on function public.custo_unitario_marca(uuid, uuid) to authenticated;
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
grant execute on function public.validar_nutricao(uuid, jsonb, jsonb, text) to authenticated;
grant execute on all functions in schema public to service_role;
