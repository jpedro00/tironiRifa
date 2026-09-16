import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { StorefrontProvider, useStorefront } from './state/SessionProvider.tsx';
import { AccessDenied, ErrorState, Loading, NotBuiltYet } from './components/States.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { AccountPage } from './pages/AccountPage.tsx';

/**
 * Vitrine da comunidade (participante).
 *
 * A vitrine e PUBLICA: carrega sem sessao. O que ela mostra nesta fase e a
 * identificacao da comunidade resolvida pelo dominio.
 *
 * NAO ha sorteio, grade, preco, contador nem barra de progresso: nada disso
 * existe ainda, e desenhar uma grade de exemplo faria a tela parecer pronta.
 */
function Shell() {
  const { tenantStatus, tenant, tenantError, reloadTenant, sessionStatus, session, logout } =
    useStorefront();

  if (tenantStatus === 'loading') return <Loading label="Carregando a comunidade…" />;

  if (tenantStatus === 'not_found') {
    return (
      <main className="content">
        <AccessDenied
          title="Comunidade não encontrada"
          message="Este endereço não corresponde a nenhuma comunidade. Confira o link que você usou."
        />
      </main>
    );
  }

  if (tenantStatus === 'error' || !tenant) {
    return (
      <main className="content">
        <ErrorState error={tenantError} onRetry={reloadTenant} />
      </main>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <h1>{tenant.publicName ?? tenant.name}</h1>
        <p className="tenant">
          <code>{tenant.slug}</code>
        </p>

        <nav className="nav" aria-label="Navegação da vitrine">
          <NavLink to="/" end>
            Início
          </NavLink>
          <NavLink to="/conta">Minha conta</NavLink>

          <p className="muted" style={{ margin: '16px 10px 4px', fontSize: 12 }}>
            Previsto para as próximas fases
          </p>
          {[
            { label: 'Sorteios', phase: 'Fase 2' },
            { label: 'Meus bilhetes', phase: 'Fase 2' },
            { label: 'Resultados', phase: 'Fase 6' },
          ].map((area) => (
            <span
              key={area.label}
              className="nav__pending"
              aria-disabled="true"
              title={`Será construído na ${area.phase}.`}
            >
              {area.label}
              <small>{area.phase}</small>
            </span>
          ))}
        </nav>

        <p style={{ marginTop: 22 }}>
          {sessionStatus === 'authenticated' && session ? (
            <>
              <span className="muted">{session.user.displayName}</span>
              <br />
              <button type="button" onClick={() => void logout()} style={{ marginTop: 8 }}>
                Sair
              </button>
            </>
          ) : (
            <NavLink to="/conta">Entrar</NavLink>
          )}
        </p>
      </aside>

      <main className="content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/conta" element={<AccountPage />} />
          <Route
            path="/sorteios"
            element={<NotBuiltYet area="Sorteios" phase="Fase 2 — núcleo de sorteios" />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  return (
    <StorefrontProvider>
      <Shell />
    </StorefrontProvider>
  );
}
