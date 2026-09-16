import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import type { TenantPermission } from '@campaigns/shared';
import { SessionProvider, useSession } from './state/SessionProvider.tsx';
import { AuthGate } from './pages/AuthGate.tsx';
import { AccessDenied, ErrorState, Loading, NotBuiltYet } from './components/States.tsx';
import { OverviewPage } from './pages/OverviewPage.tsx';
import { TeamPage } from './pages/TeamPage.tsx';
import { AuditPage } from './pages/AuditPage.tsx';

/**
 * Painel do Organizador.
 *
 * A navegacao mostra APENAS o que existe. As areas das fases seguintes
 * aparecem como previstas e indisponiveis — sem link, sem botao e sem numero
 * inventado.
 */

/** Areas ja construidas nesta fase, com a permissao que cada uma exige. */
const BUILT_AREAS: { to: string; label: string; permission: TenantPermission }[] = [
  { to: '/', label: 'Visão geral', permission: 'tenant:read' },
  { to: '/equipe', label: 'Equipe e permissões', permission: 'tenant:read' },
  { to: '/auditoria', label: 'Trilha de auditoria', permission: 'team:manage' },
];

/**
 * Areas previstas e NAO construidas. Aparecem para orientar, nunca como
 * botao funcional. Cada uma cita a fase a que pertence.
 */
const PENDING_AREAS: { label: string; phase: string }[] = [
  { label: 'Sorteios', phase: 'Fase 2' },
  { label: 'Prêmios e imagens', phase: 'Fase 3' },
  { label: 'Personalização', phase: 'Fase 4' },
  { label: 'Pagamentos', phase: 'Fase 2' },
  { label: 'Clientes cativos', phase: 'Fase 8' },
  { label: 'Resultados', phase: 'Fase 6' },
];

function Shell() {
  const { session, tenant, tenantError, tenantLoading, logout, can } = useSession();

  if (tenantLoading) return <Loading label="Carregando a comunidade…" />;

  if (tenantError) {
    // Sem vinculo com a comunidade pedida: o backend respondeu 404 de proposito.
    return (
      <div className="content">
        <ErrorState error={tenantError} />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="content">
        <AccessDenied
          title="Comunidade não identificada"
          message="Não foi possível identificar a comunidade a partir do endereço. Acesse pelo domínio da sua comunidade."
        />
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <h1>Painel do Organizador</h1>
        <p className="tenant">
          {tenant.name}
          <br />
          <code>{tenant.slug}</code>
        </p>

        <nav className="nav" aria-label="Áreas do painel">
          {BUILT_AREAS.filter((area) => can(area.permission)).map((area) => (
            <NavLink key={area.to} to={area.to} end={area.to === '/'}>
              {area.label}
            </NavLink>
          ))}

          <p className="muted" style={{ margin: '16px 10px 4px', fontSize: 12 }}>
            Previsto para as próximas fases
          </p>
          {PENDING_AREAS.map((area) => (
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
          <span className="muted">{session?.user.displayName}</span>
          <br />
          <button type="button" onClick={() => void logout()} style={{ marginTop: 8 }}>
            Sair
          </button>
        </p>
      </aside>

      <main className="content">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/equipe" element={<TeamPage />} />
          <Route
            path="/auditoria"
            element={
              can('team:manage') ? (
                <AuditPage />
              ) : (
                <AccessDenied message="Somente o dono da comunidade acessa a trilha de auditoria." />
              )
            }
          />
          <Route
            path="/sorteios"
            element={<NotBuiltYet area="Sorteios" phase="Fase 2 — núcleo NewStore" />}
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
