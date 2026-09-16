import { MEMBERSHIP_ROLE_LABELS, type MembershipRole } from '@campaigns/shared';
import { useSession } from '../state/SessionProvider.tsx';

/**
 * Visao geral da comunidade.
 *
 * Mostra somente o que a API devolveu de fato: identificacao da comunidade,
 * papeis e permissoes efetivas. NAO ha indicador de vendas, arrecadacao ou
 * sorteios — esses dados nao existem nesta fase, e exibir zeros ou valores de
 * exemplo passaria por informacao real.
 */
export function OverviewPage() {
  const { session, tenant } = useSession();
  if (!tenant || !session) return null;

  return (
    <>
      <div className="topbar">
        <h2 style={{ margin: 0 }}>{tenant.name}</h2>
        <span className="muted">Você entrou como {session.user.displayName}</span>
      </div>

      <section className="card">
        <h2>Seu acesso nesta comunidade</h2>
        <p className="muted">Papéis atribuídos à sua conta (DOC-01, seção 3).</p>
        <p>
          {tenant.roles.map((role: MembershipRole) => (
            <span className="tag" key={role}>
              {MEMBERSHIP_ROLE_LABELS[role]}
            </span>
          ))}
        </p>
      </section>

      <section className="card">
        <h2>Permissões efetivas</h2>
        <p className="muted">
          Verificadas no servidor a cada requisição. Esconder um botão não concede nem retira
          acesso.
        </p>
        <ul>
          {[...tenant.permissions].sort().map((permission) => (
            <li key={permission}>
              <code>{permission}</code>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>O que ainda não existe</h2>
        <p>
          Esta é a <strong>fundação</strong> da plataforma. Sorteios, reservas, pagamentos,
          imagens, apuração e clientes cativos serão construídos nas fases seguintes.
        </p>
        <p className="muted">
          Nenhum indicador é exibido aqui porque não há dado real para mostrar.
        </p>
      </section>
    </>
  );
}
