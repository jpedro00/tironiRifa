import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ApiClientError,
  classifySessionFailure,
  sessionNeed,
  type PublicTenantBranding,
  type SessionResponse,
} from '@campaigns/shared';
import { api } from '../api.ts';

/**
 * Estado da vitrine.
 *
 * Duas coisas independentes convivem aqui:
 *
 *   COMUNIDADE · resolvida pelo servidor a partir do dominio. A vitrine e
 *                publica: a marca carrega SEM sessao. Dominio desconhecido
 *                nao cai numa comunidade padrao — vira "nao encontrada".
 *
 *   SESSAO     · opcional. O participante pode navegar sem entrar. A area de
 *                bilhetes depende de compra, que pertence a Fase 2.
 */
export type TenantStatus = 'loading' | 'resolved' | 'not_found' | 'error';
export type SessionStatus =
  | 'loading'
  | 'anonymous'
  | 'mfa_required'
  /** Nao foi possivel FALAR com a API — nao e prova de que a sessao acabou. */
  | 'unavailable'
  | 'authenticated';

interface StorefrontState {
  readonly tenantStatus: TenantStatus;
  readonly tenant: PublicTenantBranding | null;
  readonly tenantError: unknown;
  readonly sessionStatus: SessionStatus;
  readonly session: SessionResponse | null;
  login(email: string, password: string): Promise<void>;
  verifyMfa(code: string): Promise<void>;
  logout(): Promise<void>;
  reloadTenant(): void;
}

const StorefrontContext = createContext<StorefrontState | null>(null);

export function StorefrontProvider({ children }: { children: ReactNode }) {
  const [tenantStatus, setTenantStatus] = useState<TenantStatus>('loading');
  const [tenant, setTenant] = useState<PublicTenantBranding | null>(null);
  const [tenantError, setTenantError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('loading');
  const [session, setSession] = useState<SessionResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTenantStatus('loading');
    setTenantError(null);

    api
      .call('publicTenantBranding')
      .then((result) => {
        if (cancelled) return;
        setTenant(result);
        setTenantStatus('resolved');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setTenant(null);
        setTenantError(error);
        // 404 nao e falha do sistema: e comunidade inexistente.
        const notFound =
          error instanceof ApiClientError && error.code === 'TENANT_NOT_RESOLVED';
        setTenantStatus(notFound ? 'not_found' : 'error');
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const loadSession = useCallback(async () => {
    try {
      const result = await api.call('session');
      setSession(result);
      setSessionStatus(sessionNeed(result) === 'nothing' ? 'authenticated' : 'mfa_required');
    } catch (error) {
      // Visitante sem sessao e o caso NORMAL na vitrine, nao um erro — mas
      // "nao consegui perguntar" tambem nao e "visitante". A vitrine e publica
      // e continua navegavel nos dois casos; o que muda e o que ela AFIRMA.
      if (classifySessionFailure(error) === 'unauthenticated') {
        setSession(null);
        setSessionStatus('anonymous');
        return;
      }
      setSessionStatus('unavailable');
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const value = useMemo<StorefrontState>(
    () => ({
      tenantStatus,
      tenant,
      tenantError,
      sessionStatus,
      session,

      async login(email, password) {
        await api.call('login', { email, password });
        await loadSession();
      },

      async verifyMfa(code) {
        await api.call('mfaVerify', { code });
        await loadSession();
      },

      async logout() {
        try {
          await api.call('logout');
        } finally {
          setSession(null);
          setSessionStatus('anonymous');
        }
      },

      reloadTenant() {
        setReloadToken((token) => token + 1);
      },
    }),
    [tenantStatus, tenant, tenantError, sessionStatus, session, loadSession],
  );

  return <StorefrontContext.Provider value={value}>{children}</StorefrontContext.Provider>;
}

export function useStorefront(): StorefrontState {
  const context = useContext(StorefrontContext);
  if (!context) throw new Error('useStorefront precisa estar dentro de <StorefrontProvider>.');
  return context;
}
