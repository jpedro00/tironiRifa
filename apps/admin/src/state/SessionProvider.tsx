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
  classifySessionFailure,
  sessionNeed,
  type LoginResponse,
  type PlatformPermission,
  type SessionResponse,
} from '@campaigns/shared';
import { api } from '../api.ts';

/**
 * Estado de sessao do console Super Admin.
 *
 * Diferenca essencial em relacao ao painel do organizador: aqui NAO existe
 * contexto de comunidade. O que autoriza e a lista de permissoes de
 * PLATAFORMA devolvida pela API, concedida uma a uma em `platform_admins`.
 *
 * Ser dono de uma comunidade nao coloca ninguem neste console.
 */
export type SessionStatus =
  | 'loading'
  | 'anonymous'
  | 'mfa_required'
  | 'mfa_enrollment_required'
  | 'no_platform_access'
  /**
   * Nao foi possivel FALAR com a API. Estado proprio, separado de
   * 'anonymous': erro de rede nao e prova de que a sessao acabou.
   */
  | 'unavailable'
  | 'authenticated';

interface SessionState {
  readonly status: SessionStatus;
  readonly session: SessionResponse | null;
  login(email: string, password: string): Promise<LoginResponse['status']>;
  verifyMfa(code: string): Promise<void>;
  enrollMfa(): Promise<{ secret: string; otpauthUri: string }>;
  confirmMfa(code: string): Promise<void>;
  logout(): Promise<void>;
  can(permission: PlatformPermission): boolean;
}

const SessionContext = createContext<SessionState | null>(null);

/**
 * RN12 na tela. A regra mora em `@campaigns/shared` e tem teste proprio — os
 * tres frontends faziam esta mesma conta, cada um do seu jeito.
 */
function statusFromSession(session: SessionResponse): SessionStatus {
  // RN12 antes de tudo: todo papel de plataforma exige segundo fator.
  switch (sessionNeed(session)) {
    case 'mfa_code':
      return 'mfa_required';
    case 'mfa_enrollment':
      return 'mfa_enrollment_required';
    default:
      break;
  }
  // Credencial valida e MFA satisfeito ainda NAO abrem este console: o
  // privilegio de plataforma e concedido um a um em `platform_admins`.
  if (session.platformRoles.length === 0) return 'no_platform_access';
  return 'authenticated';
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [session, setSession] = useState<SessionResponse | null>(null);

  const loadSession = useCallback(async () => {
    try {
      const result = await api.call('session');
      setSession(result);
      setStatus(statusFromSession(result));
    } catch (error) {
      // Erro de rede NAO pode fingir que a pessoa saiu. Mandar quem sofreu uma
      // queda de tres segundos para a tela de login faz a pessoa reentrar
      // achando que a sessao expirou — e perde o que estava na tela.
      if (classifySessionFailure(error) === 'unauthenticated') {
        setSession(null);
        setStatus('anonymous');
        return;
      }
      setStatus('unavailable');
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const value = useMemo<SessionState>(
    () => ({
      status,
      session,

      async login(email, password) {
        const result = await api.call('login', { email, password });
        await loadSession();
        return result.status;
      },

      async verifyMfa(code) {
        await api.call('mfaVerify', { code });
        await loadSession();
      },

      async enrollMfa() {
        return api.call('mfaEnrollStart');
      },

      async confirmMfa(code) {
        await api.call('mfaEnrollConfirm', { code });
        await loadSession();
      },

      async logout() {
        try {
          await api.call('logout');
        } finally {
          setSession(null);
          setStatus('anonymous');
        }
      },

      can(permission) {
        return session?.platformPermissions.includes(permission) ?? false;
      },
    }),
    [status, session, loadSession],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession precisa estar dentro de <SessionProvider>.');
  return context;
}
