import { useCallback, useEffect, useState } from 'react';
import type { AuditListResponse } from '@campaigns/shared';
import { api } from '../api.ts';
import { ErrorState, Loading } from '../components/States.tsx';

/**
 * Trilha de auditoria da comunidade (RN11 · M12).
 *
 * A rota exige `team:manage` e segundo fator satisfeito. A tela nao decide
 * isso: se a API recusar, o estado de erro mostra o motivo pelo codigo do
 * contrato.
 *
 * `before` e `after` NAO sao listados: podem conter dado pessoal do comprador,
 * e ler a trilha nao e o mesmo direito que ler dado pessoal.
 */
export function AuditPage() {
  const [data, setData] = useState<AuditListResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .call('tenantAudit', undefined, { query: { limit: 50 } })
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  if (loading) return <Loading label="Carregando a trilha…" />;
  if (error) return <ErrorState error={error} onRetry={load} />;

  const events = data?.events ?? [];

  return (
    <>
      <div className="topbar">
        <h2 style={{ margin: 0 }}>Trilha de auditoria</h2>
        <button type="button" onClick={load}>
          Atualizar
        </button>
      </div>

      <p className="muted">
        Registro imutável: o sistema só insere. Alterar ou excluir é bloqueado no banco (RN11).
      </p>

      <section className="card">
        {events.length === 0 ? (
          <p className="muted">
            Nenhum evento registrado nesta comunidade ainda.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Quando</th>
                <th scope="col">Ação</th>
                <th scope="col">Alvo</th>
                <th scope="col">Origem</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{new Date(event.occurredAt).toLocaleString('pt-BR')}</td>
                  <td>
                    <code>{event.action}</code>
                  </td>
                  <td>
                    {event.targetType ? `${event.targetType} ${event.targetId ?? ''}` : '—'}
                  </td>
                  <td>{event.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
