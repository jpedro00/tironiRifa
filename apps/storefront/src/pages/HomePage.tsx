import { useStorefront } from '../state/SessionProvider.tsx';

/**
 * Inicio da vitrine.
 *
 * Mostra a identificacao e o contato da comunidade — o que a API devolve de
 * fato. Nenhum sorteio, preco, contador ou barra de progresso e desenhado:
 * esses dados nao existem nesta fase, e uma grade de exemplo faria a tela
 * parecer pronta.
 */
export function HomePage() {
  const { tenant } = useStorefront();
  if (!tenant) return null;

  const contactEntries = Object.entries(tenant.contact);

  return (
    <>
      <div className="topbar">
        <h2 style={{ margin: 0 }}>{tenant.publicName ?? tenant.name}</h2>
      </div>

      <section className="card">
        <h2>Sobre esta comunidade</h2>
        <p className="muted">
          Endereço: <code>{tenant.slug}</code>
        </p>
        {contactEntries.length > 0 ? (
          <ul>
            {contactEntries.map(([key, value]) => (
              <li key={key}>
                <strong>{key}:</strong> {value}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">A comunidade ainda não publicou dados de contato.</p>
        )}
      </section>

      <section className="card">
        <h2>Sorteios</h2>
        <p>
          Esta comunidade ainda não tem sorteios disponíveis nesta plataforma. A criação e a venda
          de sorteios fazem parte da <strong>Fase 2</strong>.
        </p>
        <p className="muted">
          Nada é exibido aqui porque não há sorteio real. Nenhuma grade, preço ou contador desta
          tela é simulado.
        </p>
      </section>
    </>
  );
}
