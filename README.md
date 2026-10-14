# The Liscia Pizzas · Gestão e pedidos

Sistema da operação de bases de pizza pré-assadas e congeladas.
Duas partes que não se misturam:

- **`/pedido`**: página pública. O cliente escolhe as bases, vê o total, paga por Pix e envia o comprovante.
- **`/admin`**: painel privado, só o proprietário entra. Pedidos, conferência de Pix, campanhas, receitas, insumos e configurações.

Stack: Next.js 16 + TypeScript, Supabase (PostgreSQL, Auth e Storage privado), hospedagem na Vercel.

---

## Situação desta entrega (fases 0 e 1)

### Funcionando e testado

| Área | O que faz |
|---|---|
| Login | E-mail e senha do Supabase. Só quem está na tabela `admins` entra. Conta sem permissão é barrada no painel **e** no banco. |
| Campanhas | Nome, janela de pedidos (até 23h59 de SP), data de entrega, entrega/retirada, região, frete explícito, mínimo de bases, Pix, 100% ou 50% de sinal, prazo do comprovante. Só uma campanha ativa por vez. Sem Pix, favorecido e produto com preço, o banco não deixa ativar. |
| Produtos | Ligados a uma receita interna. O cliente vê só nome, descrição, preço e foto. |
| Página `/pedido` | Mistura de tipos com mínimo sobre a soma, entrega ou retirada, resumo com sinal e saldo. Fora da janela ou pausada: "pedidos fechados". |
| Pix | Chave, favorecido, **QR Code e Pix copia e cola já com o valor** (BR Code estático, validado contra o exemplo do Banco Central). |
| Comprovante | JPG, PNG, WebP ou PDF até 8 MB. Tipo real conferido pelo conteúdo no servidor (SVG/HTML recusados). Guardado em bucket **privado**. Enviar comprovante deixa a solicitação "aguardando conferência", nunca aprova sozinho. |
| Conferência | Lista de comprovantes e de pedidos iniciados sem comprovante. Detalhe com itens, total, sinal, saldo, comprovante (link assinado de 60 s), WhatsApp do cliente. Aprovar exige marcar "conferi no extrato". Recusar exige motivo. |
| Aprovação | Transacional e idempotente: dois cliques ou duas abas criam um único pedido e um único pagamento. Guarda quem aprovou e quando. Identificação da transação opcional, que impede reutilizar o mesmo Pix em outro pedido. |
| Pedidos | Pedido com vários itens, preço e **versão da receita fotografados**. Status de pagamento e de produção separados. Registro de recebimentos (saldo na entrega, dinheiro etc.). Pedido manual para WhatsApp, buffets e comércios. |
| Receitas | Italiana clássica e NY style cadastradas com as fichas do documento. Editar cria uma nova versão; pedidos antigos continuam com a versão usada. Calculadora de batelada por número de bases ou pela farinha disponível. |
| Insumos e configurações | Os 11 insumos iniciais (preços de referência vazios, água com custo zero), valor da hora, taxas e consumos auxiliares. |
| Início | Pagamentos aguardando conferência, bases a produzir, entregas dos próximos 7 dias, vendas entregues no mês e saldo a receber. |

**Testes executados**

- 18 testes de cálculo (dinheiro, janela de SP, mínimo, sinal, telefone, assinatura de arquivo, receitas, rateio, Pix).
- 16 testes de banco num PostgreSQL 16 real com as migrações: RLS para visitante e conta não autorizada, janela 20/10 às 23h59 aceita e 21/10 bloqueia, preço vindo só do banco, mudança de preço não altera pedido iniciado, comprovante não aprova, prazo do comprovante, **aprovação em paralelo cria um único pedido**, recusa idempotente, transação Pix duplicada, pedido manual, versão de receita, storage privado e limite de tentativas.
- Fluxo completo no navegador (desktop e celular) contra PostgREST real: criar campanha, tentar ativar sem produto, ativar, fazer pedido abaixo do mínimo e depois válido, enviar arquivo falso e depois verdadeiro, visitante tentando abrir o comprovante (negado), aprovar em duas abas ao mesmo tempo (um único pedido), registrar saldo, pedido manual. Login e storage foram simulados nesse teste; o banco e a API eram reais.

### Ainda não existe (próximas fases)

- **Fase 2, Compras e estoque**: fornecedores, compra com vários itens, leitura do cupom, rateio de frete, movimentos de estoque, lista de compras. As funções de rateio e conversão de embalagens já estão prontas e testadas em `lib/rateio.ts`.
- **Fase 3, Produção**: lotes por receita, apontamento de horas ativas, perdas, consumo real.
- **Fase 4, Resultado**: CMV, custo médio móvel, fechamento mensal com trava e reabertura, exportação.
- Confirmação automática de Pix (precisa de um provedor com webhook) e WhatsApp automático: fora do escopo inicial, como pedido.

### Pontos de atenção

- A primeira validação contra o seu Supabase real é a primeira vez que login e storage rodam de verdade. Faça o roteiro de "Primeiro teste" abaixo antes de divulgar o link.
- O horário digitado no painel (ex.: "recebido em") é interpretado como São Paulo, UTC−3. Se o horário de verão voltar a existir, isso precisa de ajuste.
- A fonte Mathes não é usada no site (licença ainda não confirmada, segundo o manual). O logo foi extraído em vetor do manual da marca e está em `public/marca/`. Textos usam DM Sans.

---

## Instalação

### 1. Supabase

1. Crie um projeto em [supabase.com](https://supabase.com) (região São Paulo, se disponível).
2. Em **SQL Editor**, rode, nesta ordem, o conteúdo de:
   - `supabase/migrations/20261014000100_fundacao.sql`
   - `supabase/migrations/20261014000200_pedidos.sql`

   (Se usar a Supabase CLI: `supabase link` e `supabase db push`.)
3. Em **Authentication → Providers → Email**, deixe e-mail ativo e **desative "Allow new users to sign up"**. Ninguém precisa se cadastrar pelo site.
4. Em **Authentication → Users → Add user**, crie o seu usuário com e-mail e senha (marque "Auto Confirm").
5. **Definir o administrador**: no SQL Editor, rode trocando o e-mail:

   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'seu-email@exemplo.com';
   ```

   Só quem estiver nessa tabela acessa o painel. Não existe outro jeito de virar administrador.
6. Em **Project Settings → API Keys**, copie a URL do projeto, a chave **publishable** (ou "anon") e a chave **secret** (ou "service_role").

### 2. Código no GitHub

Crie um repositório **privado** e envie esta pasta:

```bash
git init && git add . && git commit -m "The Liscia: fundação e pedidos"
git branch -M main
git remote add origin git@github.com:SEU-USUARIO/the-liscia.git
git push -u origin main
```

### 3. Vercel

1. **Add New → Project**, importe o repositório. O framework é detectado como Next.js.
2. Em **Environment Variables**, cadastre:

| Variável | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | chave publishable/anon |
| `SUPABASE_SECRET_KEY` | chave secret/service_role (**nunca** com prefixo `NEXT_PUBLIC_`) |
| `HASH_SALT` | um texto aleatório longo (ex.: gere com `openssl rand -hex 32`) |
| `NEXT_PUBLIC_SITE_URL` | o endereço final, ex.: `https://the-liscia.vercel.app` |

3. Deploy. Depois, se usar domínio próprio, atualize `NEXT_PUBLIC_SITE_URL` e faça novo deploy.
4. No Supabase, em **Authentication → URL Configuration**, coloque o mesmo endereço em "Site URL".

### 4. Primeiro teste (15 minutos)

1. Abra `/admin`, entre com seu usuário.
2. **Configurações**: WhatsApp e Instagram (aparecem no rodapé público), valor da hora.
3. **Campanhas → Nova campanha**: datas, entrega/retirada, frete, **sua chave Pix e o nome do favorecido**, percentual. Salve (nasce pausada).
4. Adicione os produtos com os preços definitivos e clique em **Ativar vendas**.
5. Abra `/pedido` no celular, faça um pedido de teste e pague um valor simbólico para você mesmo, ou só envie um print qualquer como comprovante.
6. No painel, **Pedidos → Pagamentos aguardando conferência**: abra, veja o comprovante, aprove ou recuse.
7. Abra o link do comprovante numa janela anônima: tem de dar acesso negado.

---

## Desenvolvimento local

```bash
npm install
cp .env.example .env.local   # preencha com um projeto Supabase de teste
npm run dev                  # http://localhost:3000
```

Testes:

```bash
npm test                                                      # cálculos (os de banco são pulados)
TEST_PGHOST=/var/run/postgresql TEST_PGPORT=5432 npm run test:db   # banco, num PostgreSQL local
```

O teste de banco cria um banco temporário, aplica `tests/db/supabase-stub.sql` (o mínimo do Supabase) e as migrações, roda e apaga.

## Como está organizado

```
app/pedido/              página pública e envio de comprovante
app/admin/               painel (cada página chama exigirAdmin())
app/admin/comprovantes/  abre comprovante com URL assinada, só para admin
lib/                     cálculos puros e testados (dinheiro, datas, pix, receitas, rateio)
lib/supabase/            clientes: sessão do usuário, servidor (chave secreta) e navegador
supabase/migrations/     tabelas, RLS, funções transacionais, bucket privado
tests/                   testes de cálculo e de banco
public/marca/            logo em SVG e PNG (verde, bordô, creme)
```

### Decisões de segurança

- **Toda regra crítica está no banco**, não só na tela: RLS em todas as tabelas, sem nenhuma política para visitantes; aprovação, recusa, criação de solicitação e de pedido manual são funções transacionais com bloqueio de linha.
- O navegador do cliente envia **apenas produto e quantidade**. Preço, total, sinal, data de entrega e Pix vêm do banco e ficam fotografados na solicitação.
- A chave secreta só existe no servidor e só é usada nas ações públicas controladas (ler a campanha ativa, criar solicitação, receber comprovante).
- O link de acompanhamento do cliente usa um token aleatório de 244 bits.
- Upload em duas etapas: o servidor libera um endereço de envio de uso único, o arquivo vai direto para o bucket privado e o servidor confere o conteúdo antes de registrar. Se for inválido, é apagado.
- Edição em duas abas: campanhas, pedidos, insumos e configurações têm controle de versão; salvar um registro desatualizado mostra aviso em vez de sobrescrever.
- **Ao criar novas funções SQL** em migrações futuras, repita o `revoke execute ... from anon` do fim de `20261014000200_pedidos.sql`, porque o Supabase libera funções novas para visitantes por padrão.
