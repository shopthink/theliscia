-- The Liscia Pizzas · Insumos da casa, perdas com motivo, pedido brinde e histórico de custo
--
-- * Insumo "da casa" (controla_estoque = false): entra no custo do lote pelo custo padrão, sem mexer em estoque.
--   Comprar um insumo da casa atualiza o custo padrão com o preço pago. Virar a chave passa a controlar estoque.
-- * Perda tem motivo (derramou, venceu, estragou, uso indevido...); ajuste de inventário é separado. Os dois vão ao fechamento.
-- * Pedido brinde (cortesia): sem valor e sem cobrança; o custo vai para "brindes e marketing" no fechamento.
-- * Histórico do custo padrão de cada insumo, para a evolução de custos.

alter table public.insumos add column controla_estoque boolean not null default true;

-- Histórico do custo padrão (preço de referência)
create table public.insumo_custos_padrao (
  id              uuid primary key default gen_random_uuid(),
  insumo_id       uuid not null references public.insumos(id) on delete cascade,
  custo_centavos  numeric(14,6) not null,
  desde           timestamptz not null default now(),
  criado_por      uuid
);
create index on public.insumo_custos_padrao (insumo_id, desde);
insert into public.insumo_custos_padrao (insumo_id, custo_centavos, desde)
select id, preco_ref_centavos, criado_em from public.insumos where preco_ref_centavos is not null;

create or replace function public.tg_insumo_custo_padrao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.preco_ref_centavos is not null
     and (tg_op = 'INSERT' or new.preco_ref_centavos is distinct from old.preco_ref_centavos) then
    insert into public.insumo_custos_padrao (insumo_id, custo_centavos, criado_por)
    values (new.id, new.preco_ref_centavos, auth.uid());
  end if;
  return null;
end;
$$;
create trigger insumos_custo_padrao after insert or update of preco_ref_centavos on public.insumos
  for each row execute function public.tg_insumo_custo_padrao();

-- Motivo das perdas e ajustes de inventário
alter table public.estoque_movimentos
  add column categoria text check (categoria in ('derramou', 'vencido', 'estragou', 'uso_indevido', 'quebra', 'outro', 'inventario'));

drop function public.registrar_ajuste_estoque(uuid, numeric, text, text, date, uuid);
create function public.registrar_ajuste_estoque(
  p_insumo_id uuid, p_quantidade numeric, p_tipo text, p_motivo text, p_data date default null,
  p_marca_id uuid default null, p_categoria text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_custo numeric; v_cat text; v_ins public.insumos%rowtype;
begin
  if not public.pode_administrar() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if p_tipo not in ('ajuste', 'perda') then raise exception 'Tipo inválido.' using errcode = 'P0001'; end if;
  if p_quantidade is null or p_quantidade = 0 then raise exception 'Informe a quantidade.' using errcode = 'P0001'; end if;
  if p_tipo = 'perda' and p_quantidade > 0 then raise exception 'Perda reduz o estoque: use quantidade negativa.' using errcode = 'P0001'; end if;
  select * into v_ins from public.insumos where id = p_insumo_id;
  if not found then raise exception 'Insumo não encontrado.' using errcode = 'P0001'; end if;
  if not v_ins.controla_estoque then
    raise exception '% é um insumo da casa (sem controle de estoque). Ligue o controle de estoque nele para lançar perdas e ajustes.', v_ins.nome using errcode = 'P0001';
  end if;
  if not public.marca_do_insumo(p_marca_id, p_insumo_id) then
    raise exception 'A marca não é deste insumo.' using errcode = 'P0001';
  end if;
  v_cat := case when p_tipo = 'ajuste' then 'inventario' else coalesce(nullif(p_categoria, ''), 'outro') end;
  if v_cat not in ('derramou', 'vencido', 'estragou', 'uso_indevido', 'quebra', 'outro', 'inventario') then
    raise exception 'Motivo inválido.' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_motivo), '') = '' and v_cat in ('outro', 'inventario') then
    raise exception 'Descreva o que aconteceu.' using errcode = 'P0001';
  end if;
  perform 1 from public.estoque_saldos where insumo_id = p_insumo_id and marca_id is not distinct from p_marca_id for update;
  v_custo := public.custo_unitario_marca(p_insumo_id, p_marca_id);
  insert into public.estoque_movimentos (insumo_id, marca_id, tipo, categoria, quantidade, valor_centavos, data, motivo, criado_por)
  values (p_insumo_id, p_marca_id, p_tipo, v_cat, p_quantidade, round(p_quantidade * v_custo, 4),
          coalesce(p_data, public.hoje_sp()), nullif(trim(coalesce(p_motivo, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

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

    if v_ins.controla_estoque then
      insert into public.estoque_movimentos (insumo_id, marca_id, tipo, quantidade, valor_centavos, data, compra_id, criado_por)
      values (v_ins.id, v_marca, 'compra', v_qtd, v_final, v_data, v_id, auth.uid());
    elsif v_qtd > 0 then
      -- Insumo da casa: não entra no estoque; o preço pago vira o novo custo padrão (fica no histórico)
      update public.insumos set preco_ref_centavos = round(v_final::numeric / v_qtd, 6) where id = v_ins.id;
    end if;
  end loop;

  return v_id;
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

  update public.lote_esperas set fim = greatest(now(), inicio) where lote_id = l.id and fim is null;

  for cons in select c.*, i.controla_estoque, i.preco_ref_centavos
                from public.lote_consumos c join public.insumos i on i.id = c.insumo_id
               where c.lote_id = l.id and c.quantidade_real > 0 loop
    if cons.controla_estoque then
      perform 1 from public.estoque_saldos where insumo_id = cons.insumo_id and marca_id is not distinct from cons.marca_id for update;
      v_custo := public.custo_unitario_marca(cons.insumo_id, cons.marca_id);
    else
      -- Insumo da casa: entra no custo pelo custo padrão, sem baixa de estoque
      v_custo := coalesce(cons.preco_ref_centavos, 0);
    end if;
    update public.lote_consumos set custo_unitario_centavos = v_custo,
           custo_total_centavos = round(cons.quantidade_real * v_custo, 4)
     where lote_id = l.id and insumo_id = cons.insumo_id;
    v_mat := v_mat + round(cons.quantidade_real * v_custo, 4);
    if cons.controla_estoque then
      insert into public.estoque_movimentos (insumo_id, marca_id, tipo, quantidade, valor_centavos, data, lote_id, motivo, criado_por)
      values (cons.insumo_id, cons.marca_id, 'producao', -cons.quantidade_real, -round(cons.quantidade_real * v_custo, 4),
              coalesce(l.produzido_em, public.hoje_sp()), l.id, 'Lote L-' || lpad(l.numero::text, 4, '0'), auth.uid());
    end if;
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
-- Pedido brinde (cortesia)
-- ---------------------------------------------------------------------------
alter table public.pedidos add column tipo text not null default 'venda' check (tipo in ('venda', 'brinde'));
alter table public.pedidos drop constraint pedidos_status_pagamento_check;
alter table public.pedidos add constraint pedidos_status_pagamento_check
  check (status_pagamento in ('pendente','em_conferencia','sinal_confirmado','integral_confirmado','recusado','cortesia'));
alter table public.pedidos add constraint pedido_brinde_sem_valor check (tipo = 'venda' or (total_centavos = 0 and status_pagamento = 'cortesia'));

create or replace function public.recalcular_pagamento(p_pedido_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_total integer; v_rec integer; v_status text; v_tipo text;
begin
  select total_centavos, status_pagamento, tipo into v_total, v_status, v_tipo from public.pedidos where id = p_pedido_id for update;
  if not found then return; end if;
  if v_tipo = 'brinde' then return; end if;
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

-- Brinde não recebe pagamento
create or replace function public.tg_pagamento_brinde()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.pedidos where id = new.pedido_id and tipo = 'brinde') then
    raise exception 'Pedido brinde não recebe pagamento.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger pagamentos_brinde before insert on public.pagamentos
  for each row execute function public.tg_pagamento_brinde();

drop function public.criar_pedido_manual(text, text, text, text, date, text, jsonb, uuid, jsonb, uuid, text, text, integer);
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
  p_taxa_entrega_centavos integer default 0,
  p_tipo           text default 'venda'
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
  if coalesce(p_tipo, '') not in ('venda', 'brinde') then raise exception 'Tipo de pedido inválido.' using errcode = 'P0001'; end if;
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
  if v_mod = 'retirada' or p_tipo = 'brinde' then v_taxa := 0; end if;
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
  if p_tipo = 'brinde' then v_total := 0; end if;
  v_total := v_total + v_taxa;

  insert into public.pedidos (cliente_id, cliente_nome, cliente_telefone, origem, campanha_id,
                              modalidade, endereco, entrega_em, observacoes, total_centavos, criado_por,
                              condominio_id, condominio_nome, bloco, apto, taxa_entrega_centavos, tipo, status_pagamento)
  values (v_cliente, v_nome, v_tel, 'manual', p_campanha_id, v_mod,
          case when v_mod = 'entrega' then v_end end,
          p_entrega_em, nullif(trim(coalesce(p_observacoes, '')), ''), v_total, auth.uid(),
          p_condominio_id, co.nome, v_bloco, v_apto, v_taxa, p_tipo,
          case when p_tipo = 'brinde' then 'cortesia' else 'pendente' end)
  returning id into v_pedido;

  insert into public.pedido_itens (pedido_id, receita_id, receita_versao_id, nome, quantidade, preco_unit_centavos, subtotal_centavos)
  select v_pedido, r.id, r.versao_atual_id, r.nome,
         (e->>'quantidade')::integer,
         case when p_tipo = 'brinde' then 0 else (e->>'preco_centavos')::integer end,
         case when p_tipo = 'brinde' then 0 else (e->>'quantidade')::integer * (e->>'preco_centavos')::integer end
    from jsonb_array_elements(p_itens) e
    join public.receitas r on r.id = (e->>'receita_id')::uuid;
  if (select count(*) from public.pedido_itens where pedido_id = v_pedido) <> jsonb_array_length(p_itens) then
    raise exception 'Receita inválida.' using errcode = 'P0001';
  end if;

  if p_tipo = 'venda' and p_pagamento is not null and coalesce((p_pagamento->>'valor_centavos')::integer, 0) > 0 then
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
alter table public.insumo_custos_padrao enable row level security;
create policy adm_read on public.insumo_custos_padrao for select to authenticated using (public.is_admin());
revoke all on public.insumo_custos_padrao from anon;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.marca_do_insumo(uuid, uuid) to authenticated;
grant execute on function public.chave_marcas(jsonb) to authenticated;
grant execute on function public.definir_marca_em_uso(uuid) to authenticated;
grant execute on function public.nova_versao_receita(uuid, numeric, jsonb, text, numeric) to authenticated;
grant execute on function public.aprovar_solicitacao(uuid, integer, text, timestamptz) to authenticated;
grant execute on function public.recusar_solicitacao(uuid, text) to authenticated;
grant execute on function public.criar_pedido_manual(text, text, text, text, date, text, jsonb, uuid, jsonb, uuid, text, text, integer, text) to authenticated;
grant execute on function public.campanha_pode_vender(uuid) to authenticated;
grant execute on function public.bases_condominio(uuid, uuid) to authenticated;
grant execute on function public.salvar_compra(jsonb) to authenticated;
grant execute on function public.excluir_compra(uuid, text) to authenticated;
grant execute on function public.registrar_ajuste_estoque(uuid, numeric, text, text, date, uuid, text) to authenticated;
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
