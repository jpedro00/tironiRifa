import { useState, type FormEvent } from 'react';
import { ApiClientError } from '@campaigns/shared';
import { useStorefront } from '../state/SessionProvider.tsx';
import { Loading } from '../components/States.tsx';

/**
 * Minha conta.
 *
 * Usa as MESMAS rotas de identidade do restante da plataforma. Nao ha usuario
 * fixo, token permanente nem estado do navegador fazendo as vezes de
 * autenticacao: o cookie de sessao e httpOnly e o servidor decide.
 *
 * "Meus bilhetes" depende de compra, que pertence a Fase 2 — por isso aparece
 * como area prevista, sem botao funcional.
 */
export function AccountPage() {
  const { sessionStatus, session, login, verifyMfa, logout } = useStorefront();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  function message(caught: unknown): string {
    if (caught instanceof ApiClientError) return caught.message;
    return 'Não foi possível concluir. Verifique sua conexão e tente novamente.';
  }

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
    } catch (caught) {
      setError(caught);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await verifyMfa(code);
    } catch (caught) {
      setError(caught);
      setCode('');
    } finally {
      setSubmitting(false);
    }
  }

  if (sessionStatus === 'loading') return <Loading label="Verificando sua sessão…" />;

  if (sessionStatus === 'mfa_required') {
    return (
      <section className="card" style={{ maxWidth: 440 }}>
        <h2>Verificação em duas etapas</h2>
        <p className="muted">Digite o código de 6 dígitos do seu aplicativo autenticador.</p>
        {error != null && (
          <p className="form-error" role="alert">
            {message(error)}
          </p>
        )}
        <form onSubmit={handleVerify}>
          <div className="field">
            <label htmlFor="code">Código</label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            />
          </div>
          <button type="submit" data-variant="primary" disabled={submitting || code.length !== 6}>
            {submitting ? 'Verificando…' : 'Verificar'}
          </button>
          <button type="button" onClick={() => void logout()} style={{ marginLeft: 8 }}>
            Sair
          </button>
        </form>
      </section>
    );
  }

  if (sessionStatus === 'authenticated' && session) {
    return (
      <>
        <h2>Minha conta</h2>
        <section className="card">
          <p>
            <strong>{session.user.displayName}</strong>
            <br />
            <span className="muted">{session.user.email}</span>
          </p>
          <button type="button" onClick={() => void logout()}>
            Sair
          </button>
        </section>

        <section className="card">
          <h2>Meus bilhetes</h2>
          <p>
            A compra de números faz parte da <strong>Fase 2</strong>. Quando existir, seus bilhetes
            aparecerão aqui.
          </p>
          <p className="muted">Nenhum bilhete de exemplo é exibido.</p>
        </section>
      </>
    );
  }

  return (
    <section className="card" style={{ maxWidth: 440 }}>
      <h2>Entrar</h2>
      {error != null && (
        <p className="form-error" role="alert">
          {message(error)}
        </p>
      )}
      <form onSubmit={handleLogin}>
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Senha</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <button type="submit" data-variant="primary" disabled={submitting}>
          {submitting ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <p className="muted" style={{ marginTop: 14 }}>
        O cadastro de participante acontece na compra, que faz parte da Fase 2.
      </p>
    </section>
  );
}
