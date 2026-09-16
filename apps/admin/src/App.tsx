import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { PLATFORM_ROLE_LABELS, type PlatformPermission } from '@campaigns/shared';
import { SessionProvider, useSession } from './state/SessionProvider.tsx';
import { AuthGate } from './pages/AuthGate.tsx';
import { AccessDenied, NotBuiltYet } from './components/States.tsx';
import { TenantsPage } from './pages/TenantsPage.tsx';

/**
 * Console Super Admin.
 *
 * A navegacao e montada a partir das PERMISSOES DE PLATAFORMA devolvidas pela
 * API. Um sub-perfil so ve as areas que o DOC-01 secao 17 lhe atribui — nenhum
 * sub-perfil recebe tudo.
 *
 * Fila de revisao, risco, cobrancas e saude aparecem como previstos e
 * indisponiveis: as rotas correspondentes ainda nao existem no backend.
 */
const BUILT_AREAS: { to: string; label: string; permission: PlatformPermission }[] = [
  { to: '/', label: 'Comunidades', permission: 'platform:tenant:read' },
];

const PENDING_AREAS: { label: string; phase: string; permission: PlatformPermission }[] = [
  { label: 'Fila de revisão', phase: 'Fase 5', permission: 'platform:review:read' },
  { label: 'Risco', phase: 'Fase 9', permission: 'platform:risk:read' },
  { label: 'Cobranças', phase: 'Fase 9', permission: 'platform:billing:read' },
  { label: 'Saúde dos jobs', phase: 'Fase 9', permission: 'platform:health:read' },
];

function Shell() {
  const { session, logout, can } = useSession();
  if (!session) return null;

  const visibleBuilt = BUILT_AREAS.filter((area) => can(area.permission));
  const visiblePending = PENDING_AREAS.filter((area) => can(area.permission));

  return (
    <div className="shell">
      <aside className="sidebar">
        <h1>Console Super Admin</h1>
        <p className="tenant">
          {session.platformRoles.map((role) => (
            <span className="tag tag--adm" key={role}>
              {PLATFORM_ROLE_LABELS[role]}
            </span>
          ))}
        </p>

        <nav className="nav" aria-label="Áreas do console">
          {visibleBuilt.map((area) => (
            <NavLink key={area.to} to={area.to} end>
              {area.label}
            </NavLink>
          ))}

          {visiblePending.length > 0 && (
            <>
              <p className="muted" style={{ margin: '16px 10px 4px', fontSize: 12 }}>
                Previsto para as próximas fases
              </p>
              {visiblePending.map((area) => (
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
            </>
          )}
        </nav>

        <p style={{ marginTop: 22 }}>
          <span className="muted">{session.user.displayName}</span>
          <br />
          <button type="button" onClick={() => void logout()} style={{ marginTop: 8 }}>
            Sair
          </button>
        </p>
      </aside>

      <main className="content">
        <Routes>
          <Route
            path="/"
            element={
              can('platform:tenant:read') ? (
                <TenantsPage />
              ) : (
                <AccessDenied message="Seu perfil de Super Admin não inclui a leitura de comunidades." />
              )
            }
          />
          <Route
            path="/revisao"
            element={<NotBuiltYet area="Fila de revisão" phase="Fase 5 — ciclo de vida e revisão" />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  return (
    <SessionProvider>
      <AuthGate>
        <Shell />
      </AuthGate>
    </SessionProvider>
  );
}
