import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiClientError } from '@campaigns/shared';
import { useSession } from '../state/SessionProvider.tsx';
import { Loading } from '../components/States.tsx';

/**
 * Porteiro de sessao do console da plataforma.
 *
 * Alem de exigir sessao e segundo fator (RN12), trata um estado proprio deste
 * console: `no_platform_access`. Uma pessoa pode ter credencial valida, MFA
 * satisfeito e mesmo assim NAO ter privilegio de plataforma — inclusive sendo
 * dona de uma comunidade. Nesse caso nao ha console a mostrar.
 *
 * Isto e conveniencia de navegacao, nao controle de acesso: quem decide e o
 * backend, em toda requisicao.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useSession();

  if (status === 'loading') return <Loading label="Verificando sua sessão…" />;
  if (status === 'anonymous') return <LoginScreen />;
  if (status === 'mfa_required') return <MfaVerifyScreen />;
  if (status === 'mfa_enrollment_required') return <MfaEnrollScreen />;
  if (status === 'no_platform_access') return <NoPlatformAccessScreen />;
  if (status === 'unavailable') return <UnavailableScreen />;
  return <>{children}</>;
}

function messageFor(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  return 'Não foi possível concluir. Verifique sua conexão e tente novamente.';
}

/**
 * A API nao respondeu.
 *
 * Tela PROPRIA, e nao a de login. Mandar quem sofreu uma queda de rede para o
 * formulario de entrada afirma algo que nao foi verificado — "sua sessao
 * acabou" — e faz a pessoa reentrar sem necessidade. Aqui a interface diz o que
 * de fato sabe e oferece a unica acao util: tentar de novo.
 */
function UnavailableScreen() {
  return (
    <div className="auth">
      <div className="auth__box" role="alert">
        <h1>Sem conexao com o servidor</h1>
        <p className="muted">
          Nao foi possivel confirmar sua sessao. Isso costuma ser falha de rede, e a sua sessao
          provavelmente continua valida.
        </p>
        <button type="button" onClick={() => window.location.reload()}>
          Tentar novamente
        </button>
      </div>
    </div>
  );
}

function LoginScreen() {
  const { login } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
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

  return (
    <div className="auth">
      <form className="auth__box" onSubmit={handleSubmit}>
        <h1>Console Super Admin</h1>
        <p className="muted">Acesso restrito à equipe da plataforma.</p>

        {error != null && (
          <p className="form-error" role="alert">
            {messageFor(error)}
          </p>
        )}

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
    </div>
  );
}

function MfaVerifyScreen() {
  const { verifyMfa, logout } = useSession();
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
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

  return (
    <div className="auth">
      <form className="auth__box" onSubmit={handleSubmit}>
        <h1>Verificação em duas etapas</h1>
        <p className="muted">
          Digite o código de 6 dígitos do seu aplicativo autenticador.
        </p>

        {error != null && (
          <p className="form-error" role="alert">
            {messageFor(error)}
          </p>
        )}

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
    </div>
  );
}

/**
 * Cadastro obrigatorio do segundo fator.
 *
 * RN12 exige MFA para dono e financeiro. Quem cai aqui nao tem fator
 * cadastrado: a unica saida e cadastrar ou sair. Nao existe "pular".
 */
function MfaEnrollScreen() {
  const { enrollMfa, confirmMfa, logout } = useSession();
  const [enrollment, setEnrollment] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      setEnrollment(await enrollMfa());
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await confirmMfa(code);
    } catch (caught) {
      setError(caught);
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth__box">
        <h1>Ative a verificação em duas etapas</h1>
        <p className="muted">
          Todo perfil de Super Admin exige verificação em duas etapas (RN12).
        </p>

        {error != null && (
          <p className="form-error" role="alert">
            {messageFor(error)}
          </p>
        )}

        {!enrollment ? (
          <button type="button" data-variant="primary" onClick={() => void start()} disabled={busy}>
            {busy ? 'Gerando…' : 'Gerar chave'}
          </button>
        ) : (
          <form onSubmit={confirm}>
            <p>
              Cadastre esta chave no seu aplicativo autenticador. Ela é exibida{' '}
              <strong>uma única vez</strong>.
            </p>
            <p>
              <code>{enrollment.secret}</code>
            </p>

            <div className="field">
              <label htmlFor="enroll-code">Código gerado pelo aplicativo</label>
              <input
                id="enroll-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              />
            </div>

            <button type="submit" data-variant="primary" disabled={busy || code.length !== 6}>
              {busy ? 'Confirmando…' : 'Confirmar'}
            </button>
          </form>
        )}

        <p style={{ marginTop: 16 }}>
          <button type="button" onClick={() => void logout()}>
            Sair
          </button>
        </p>
      </div>
    </div>
  );
}

/**
 * Autenticado, porem sem privilegio de PLATAFORMA.
 *
 * Papel de comunidade nao concede acesso global. A concessao e explicita, uma
 * a uma, em `platform_admins`.
 */
function NoPlatformAccessScreen() {
  const { session, logout } = useSession();

  return (
    <div className="auth">
      <div className="auth__box">
        <h1>Sem acesso ao console</h1>
        <p>
          A conta <strong>{session?.user.email}</strong> não tem privilégio de plataforma.
        </p>
        <p className="muted">
          Ser dono ou financeiro de uma comunidade não concede acesso ao console da plataforma.
          Esse privilégio é concedido separadamente.
        </p>
        <button type="button" onClick={() => void logout()}>
          Sair
        </button>
      </div>
    </div>
  );
}
