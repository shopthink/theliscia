export function TopoPublico({ chamada }: { chamada?: string }) {
  return (
    <header className="topo-publico">
      <div className="miolo">
        <a href="/pedido" aria-label="The Liscia Pizzas"><img src="/marca/logo-creme.svg" alt="The Liscia Pizzas" /></a>
        {chamada && <span className="chamada">{chamada}</span>}
      </div>
    </header>
  );
}

export function RodapePublico({ whatsapp, instagram }: { whatsapp?: string | null; instagram?: string | null }) {
  return (
    <footer className="rodape-publico">
      <div>Pizza do nosso jeito.</div>
      {(whatsapp || instagram) && (
        <div style={{ marginTop: "0.35rem" }}>
          {whatsapp && <a href={`https://wa.me/55${whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener">WhatsApp</a>}
          {whatsapp && instagram && " · "}
          {instagram && <a href={`https://instagram.com/${instagram.replace(/^@/, "")}`} target="_blank" rel="noopener">Instagram</a>}
        </div>
      )}
    </footer>
  );
}
