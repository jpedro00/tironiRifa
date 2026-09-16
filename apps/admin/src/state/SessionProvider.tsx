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

function statusFromSession(session: SessionResponse): SessionStatus {
  // RN12: todo papel de plataforma exige segundo fator.
  if (session.mfaRequired && !session.mfaSatisfied) {
    return session.mfaEnrolled ? 'mfa_required' : 'mfa_enrollment_required';
  }
  if (session.mfaEnrolled && !session.mfaSatisfied) return 'mfa_required';
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
      if (error instanceof ApiClientError && error.code === 'UNAUTHENTICATED') {
        setSession(null);
        setStatus('anonymous');
        return;
      }
      setSession(null);
      setStatus('anonymous');
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
