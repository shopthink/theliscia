-- The Liscia Pizzas · ZERAR TUDO (menos o acesso)
--
-- Apaga de vez todos os dados do sistema: insumos, marcas, receitas, compras, estoque, lotes, campanhas,
-- pedidos, pagamentos, clientes, condomínios e configurações (voltam ao padrão).
-- Mantém: os usuários de login e a tabela de administradores (o seu acesso).
-- Não tem volta. Arquivos de comprovante no Storage não são apagados por aqui.

do $$
declare t text;
begin
  for t in
    select format('%I.%I', schemaname, tablename) from pg_tables
     where schemaname = 'public' and tablename <> 'admins'
  loop
    execute 'truncate table ' || t || ' restart identity cascade';
  end loop;
  for t in select format('%I.%I', sequence_schema, sequence_name) from information_schema.sequences where sequence_schema = 'public' loop
    execute 'alter sequence ' || t || ' restart with 1';
  end loop;
end $$;

-- Configurações voltam ao padrão (linha única obrigatória)
insert into public.configuracoes (id) values (true);

select (select count(*) from public.admins) as administradores_mantidos,
       (select count(*) from public.insumos) as insumos,
       (select count(*) from public.pedidos) as pedidos;
