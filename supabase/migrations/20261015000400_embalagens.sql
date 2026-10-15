-- The Liscia Pizzas · Embalagens de compra
-- O insumo continua controlado em g, ml ou un (unidade da receita e do estoque).
-- Cada insumo pode ter embalagens em que é vendido: pacote 1 kg, 5 kg, lata 350 ml...
-- Usadas para preencher compras e sugerir quantos pacotes comprar na lista de compras.

create table public.insumo_embalagens (
  id               uuid primary key default gen_random_uuid(),
  insumo_id        uuid not null references public.insumos(id) on delete cascade,
  nome             text not null check (length(trim(nome)) between 1 and 60),
  conteudo         numeric(12,3) not null check (conteudo > 0),
  unidade          text not null check (unidade in ('g', 'kg', 'ml', 'l', 'un')),
  quantidade_base  numeric(14,3) generated always as
                   (conteudo * case when unidade in ('kg', 'l') then 1000 else 1 end) stored,
  ativo            boolean not null default true,
  criado_em        timestamptz not null default now(),
  unique (insumo_id, conteudo, unidade)
);
create index on public.insumo_embalagens (insumo_id);

-- A embalagem precisa estar numa unidade compatível com o insumo
create or replace function public.tg_embalagem_unidade()
returns trigger
language plpgsql
as $$
declare v_un text;
begin
  select unidade into v_un from public.insumos where id = new.insumo_id;
  if (v_un = 'g' and new.unidade not in ('g', 'kg'))
     or (v_un = 'ml' and new.unidade not in ('ml', 'l'))
     or (v_un = 'un' and new.unidade <> 'un') then
    raise exception 'A embalagem precisa estar em %.',
      case v_un when 'g' then 'g ou kg' when 'ml' then 'ml ou L' else 'unidades' end
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger insumo_embalagens_unidade before insert or update on public.insumo_embalagens
  for each row execute function public.tg_embalagem_unidade();

-- Embalagens informadas pelo proprietário (as demais ele cadastra no painel)
insert into public.insumo_embalagens (insumo_id, nome, conteudo, unidade)
select i.id, e.nome, e.conteudo, e.unidade
  from public.insumos i
  join (values
    ('Farinha', 'Pacote 1 kg',  1::numeric,   'kg'),
    ('Farinha', 'Pacote 5 kg',  5::numeric,   'kg'),
    ('Farinha', 'Pacote 10 kg', 10::numeric,  'kg'),
    ('Cerveja', 'Lata 350 ml',  350::numeric, 'ml')
  ) as e(insumo, nome, conteudo, unidade) on e.insumo = i.nome
on conflict do nothing;

alter table public.insumo_embalagens enable row level security;
create policy adm_all on public.insumo_embalagens for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from public, anon;
