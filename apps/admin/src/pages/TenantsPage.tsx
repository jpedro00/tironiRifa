import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiClientError, type TenantListResponse } from '@campaigns/shared';
import { api } from '../api.ts';
import { useSession } from '../state/SessionProvider.tsx';
import { ErrorState, Loading } from '../components/States.tsx';

/**
 * Comunidades da plataforma. DOC-01 secao 2, passo 1 (M01 · M11 · RN01).
 *
 * Criar comunidade grava, na MESMA transacao: a comunidade, a trilha de
 * auditoria e o evento `tenant.created` na outbox. O worker consome o evento e
 * provisiona a marca padrao.
 *
 * O formulario so aparece para quem tem `platform:tenant:create`. Isso e
 * conveniencia: o backend recusa a rota de qualquer forma.
 */
export function TenantsPage() {
  const { can } = useSession();
  const [data, setData] = useState<TenantListResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .call('platformTenants')
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  if (loading) return <Loading label="Carregando comunidades…" />;
  if (error) return <ErrorState error={error} onRetry={load} />;

  const tenants = data?.tenants ?? [];

  return (
    <>
      <div className="topbar">
        <h2 style={{ margin: 0 }}>Comunidades</h2>
        <button type="button" onClick={load}>
          Atualizar
        </button>
      </div>

      {can('platform:tenant:create') && <CreateTenantForm onCreated={load} />}

      <section className="card">
        {tenants.length === 0 ? (
          <p className="muted">Nenhuma comunidade criada ainda.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">Identificador</th>
                <th scope="col">Situação</th>
                <th scope="col">Criada em</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr key={tenant.id}>
                  <td>{tenant.name}</td>
                  <td>
                    <code>{tenant.slug}</code>
                  </td>
                  <td>{tenant.status}</td>
                  <td>{new Date(tenant.createdAt).toLocaleDateString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function CreateTenantForm({ onCreated }: { onCreated: () => void }) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setCreated(null);
    try {
      const result = await api.call('platformCreateTenant', { slug, name });
      setCreated(result.slug);
      setSlug('');
      setName('');
      onCreated();
    } catch (caught) {
      setError(caught);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card">
      <h2>Criar comunidade</h2>
      <p className="muted">
        O identificador vira o endereço da vitrine: <code>{'{identificador}'}.plataforma.com.br</code>
      </p>

      {error != null && (
        <p className="form-error" role="alert">
          {error instanceof ApiClientError ? error.message : 'Não foi possível criar a comunidade.'}
        </p>
      )}

      {created && (
        <p className="muted" role="status">
          Comunidade <code>{created}</code> criada. A marca padrão é provisionada pelo worker.
        </p>
      )}

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="name">Nome da comunidade</label>
          <input
            id="name"
            required
            minLength={2}
            maxLength={160}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="slug">Identificador (slug)</label>
          <input
            id="slug"
            required
            minLength={3}
            maxLength={63}
            pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
            value={slug}
            onChange={(event) => setSlug(event.target.value.toLowerCase())}
          />
        </div>

        <button type="submit" data-variant="primary" disabled={submitting}>
          {submitting ? 'Criando…' : 'Criar comunidade'}
        </button>
      </form>
    </section>
  );
}
