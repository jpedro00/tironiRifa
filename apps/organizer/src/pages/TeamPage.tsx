import {
  MEMBERSHIP_ROLES,
  MEMBERSHIP_ROLE_LABELS,
  TENANT_ROLE_PERMISSIONS,
  type MembershipRole,
  type TenantPermission,
} from '@campaigns/shared';
import { useSession } from '../state/SessionProvider.tsx';

/**
 * Equipe e permissoes — transcricao da matriz do DOC-01, secao 3.
 *
 * A matriz vem de packages/shared, a MESMA fonte que o backend usa para
 * autorizar. Nao ha uma copia da tabela no frontend que possa divergir.
 *
 * Convidar e remover membros pertence a M01 e ainda nao foi construido: o
 * botao nao existe, em vez de existir e falhar.
 */
const ROWS: { label: string; permission: TenantPermission }[] = [
  { label: 'Criar e editar sorteio', permission: 'draw:write' },
  { label: 'Enviar imagens e personalizar', permission: 'draw:media:write' },
  { label: 'Enviar para revisão / pausar / encerrar', permission: 'draw:lifecycle:write' },
  { label: 'Ver pagamentos e conciliação', permission: 'payment:read:full' },
  { label: 'Ver apenas o status do pagamento', permission: 'payment:read:status' },
  { label: 'Estornar pagamento', permission: 'payment:refund' },
  { label: 'Gerenciar clientes cativos', permission: 'captive:manage' },
  { label: 'Ver dados completos do comprador', permission: 'buyer:read:full' },
  { label: 'Reenviar comprovante / atender', permission: 'support:act' },
  { label: 'Convidar e remover equipe', permission: 'team:manage' },
  { label: 'Alterar marca da comunidade', permission: 'branding:write' },
];

function has(role: MembershipRole, permission: TenantPermission): boolean {
  return (TENANT_ROLE_PERMISSIONS[role] as readonly TenantPermission[]).includes(permission);
}

export function TeamPage() {
  const { tenant } = useSession();
  if (!tenant) return null;

  return (
    <>
      <h2>Equipe e permissões</h2>
      <p className="muted">
        Matriz do DOC-01, seção 3. É a mesma definição usada pelo servidor para autorizar cada
        requisição.
      </p>

      <section className="card">
        <table>
          <caption className="muted" style={{ captionSide: 'bottom', paddingTop: 8 }}>
            ✅ permitido · — negado
          </caption>
          <thead>
            <tr>
              <th scope="col">Ação</th>
              {MEMBERSHIP_ROLES.map((role) => (
                <th key={role} scope="col">
                  {MEMBERSHIP_ROLE_LABELS[role]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.permission}>
                <th scope="row" style={{ background: 'transparent', fontWeight: 400 }}>
                  {row.label}
                </th>
                {MEMBERSHIP_ROLES.map((role) => (
                  <td key={role}>
                    <span aria-label={has(role, row.permission) ? 'permitido' : 'negado'}>
                      {has(role, row.permission) ? '✅' : '—'}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Seus papéis</h2>
        <p>
          {tenant.roles.map((role) => (
            <span className="tag" key={role}>
              {MEMBERSHIP_ROLE_LABELS[role]}
            </span>
          ))}
        </p>
        <p className="muted">
          Convidar e remover membros ainda não foi construído. A rota correspondente não existe no
          servidor, então nenhum botão é oferecido aqui.
        </p>
      </section>
    </>
  );
}
