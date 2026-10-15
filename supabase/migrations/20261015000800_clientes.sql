-- The Liscia Pizzas · Mini CRM de clientes
--
-- * Aceite de novidades (LGPD): só entra em listas de divulgação quem marcou. Nunca é desmarcado por um pedido.
-- * Leads: quem começou um pedido e não pagou, ou foi cadastrado à mão (WhatsApp, Instagram, indicação...).
-- * Segmentos calculados (lead, novo, recorrente, sumido) e "fã" (quem mais compra).

alter table public.clientes
  add column aceita_novidades  boolean not null default false,
  add column aceite_em         timestamptz,
  add column aceite_origem     text check (aceite_origem is null or length(aceite_origem) <= 40),
  add column origem            text check (origem is null or length(origem) <= 40),
  add column anotacoes         text check (anotacoes is null or length(anotacoes) <= 2000),
  add column etiquetas         text[] not null default '{}',
  add column versao            integer not null default 1;
create trigger clientes_versionar before update on public.clientes
  for each row execute function public.tg_versionar();

-- Quem já existia veio de pedido
update public.clientes set origem = 'pedido' where origem is null;
alter table public.clientes alter column origem set default 'pedido';

alter table public.configuracoes
  add column dias_sumido integer not null default 45 check (dias_sumido between 7 and 365);

-- Aceite registrado pelo formulário público (só o servidor chama). Só liga; nunca desliga.
create or replace function public.registrar_aceite_novidades(p_telefone text, p_origem text default 'pedido')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.clientes
     set aceita_novidades = true,
         aceite_em = coalesce(aceite_em, now()),
         aceite_origem = coalesce(aceite_origem, left(p_origem, 40))
   where telefone = public.normalizar_telefone(p_telefone)
     and not aceita_novidades;
end;
$$;

-- Resumo por cliente. security_invoker: respeita o RLS (só o administrador lê).
create or replace view public.clientes_resumo
with (security_invoker = true) as
with ped as (
  select p.cliente_id,
         count(*)::integer                         as pedidos,
         coalesce(sum(i.bases), 0)::integer        as bases,
         coalesce(sum(p.total_centavos), 0)::bigint as total_centavos,
         min(p.criado_em)                          as primeiro_pedido_em,
         max(p.criado_em)                          as ultimo_pedido_em
    from public.pedidos p
    left join (select pedido_id, sum(quantidade) as bases from public.pedido_itens group by pedido_id) i on i.pedido_id = p.id
   where p.status_producao <> 'cancelado'
   group by p.cliente_id
), sol as (
  select s.cliente_id, count(*)::integer as nao_pagas, max(s.criado_em) as ultima_tentativa_em
    from public.solicitacoes s
   where s.status <> 'aprovada'
   group by s.cliente_id
), base as (
  select c.id, c.nome, c.telefone, c.endereco, c.condominio_id, co.nome as condominio_nome, co.slug as condominio_slug,
         c.bloco, c.apto, c.aceita_novidades, c.aceite_em, c.origem, c.anotacoes, c.etiquetas, c.criado_em, c.versao,
         coalesce(ped.pedidos, 0) as pedidos,
         coalesce(ped.bases, 0) as bases,
         coalesce(ped.total_centavos, 0) as total_centavos,
         ped.primeiro_pedido_em, ped.ultimo_pedido_em,
         coalesce(sol.nao_pagas, 0) as nao_pagas, sol.ultima_tentativa_em
    from public.clientes c
    left join ped on ped.cliente_id = c.id
    left join sol on sol.cliente_id = c.id
    left join public.condominios co on co.id = c.condominio_id
)
select b.*,
       case
         when b.pedidos = 0 then 'lead'
         when b.ultimo_pedido_em < now() - make_interval(days => (select dias_sumido from public.configuracoes limit 1)) then 'sumido'
         when b.pedidos >= 2 then 'recorrente'
         else 'novo'
       end as segmento,
       (b.pedidos >= 2 and percent_rank() over (partition by (b.pedidos > 0) order by b.total_centavos) >= 0.8) as fa
  from base b;

revoke all on public.clientes_resumo from anon;
grant select on public.clientes_resumo to authenticated;

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
