import { FormAcao } from "@/components/FormAcao";
import { entrar } from "./actions";

export const metadata = { title: "Entrar", robots: { index: false } };

export default async function Login({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  return (
    <main className="tela-login">
      <div>
        <img src="/marca/logo-creme.svg" alt="The Liscia Pizzas" />
        <div className="cartao">
          <h1 style={{ fontSize: "1.2rem" }}>Painel</h1>
          {erro === "sem-acesso" && <div className="aviso erro">Esta conta não tem acesso ao painel.</div>}
          <FormAcao acao={entrar} botao="Entrar" classeBotao="largo">
            <div className="campo">
              <label htmlFor="email">E-mail</label>
              <input id="email" name="email" type="email" autoComplete="username" required />
            </div>
            <div className="campo">
              <label htmlFor="senha">Senha</label>
              <input id="senha" name="senha" type="password" autoComplete="current-password" required />
            </div>
          </FormAcao>
        </div>
      </div>
    </main>
  );
}
