import type { Request, RequestHandler, Response } from 'express';
import { withUser } from '@campaigns/db';
import {
  loginRequestSchema,
  mfaCodeRequestSchema,
  type LoginResponse,
  type MembershipRole,
  type MembershipSummary,
  type SessionResponse,
} from '@campaigns/shared';
import type { AppDeps } from '../../deps.js';
import { ApiError } from '../../lib/apiError.js';
import {
  confirmMfaEnrollment,
  login,
  revokeAllSessions,
  revokeSession,
  startMfaEnrollment,
  verifyMfaForSession,
} from './authService.js';

/** M01 · rotas de identidade. */

function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

function setSessionCookie(deps: AppDeps, res: Response, token: string): void {
  res.cookie(deps.config.SESSION_COOKIE_NAME, token, {
    httpOnly: true, // JavaScript da pagina nao le o token.
    secure: deps.config.SESSION_COOKIE_SECURE,
    sameSite: 'lax', // navegacao normal funciona; POST de outro site, nao.
    path: '/',
    maxAge: deps.config.SESSION_TTL_HOURS * 3600 * 1000,
  });
}

function clearSessionCookie(deps: AppDeps, res: Response): void {
  res.clearCookie(deps.config.SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: deps.config.SESSION_COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
  });
}

function requireSession(req: Request) {
  const session = req.session;
  if (!session) throw ApiError.unauthenticated();
  return session;
}

export function buildAuthHandlers(deps: AppDeps): Record<string, RequestHandler> {
  return {
    login: asyncHandler(async (req, res) => {
      const body = loginRequestSchema.parse(req.body);
      const outcome = await login(deps, {
        email: body.email,
        password: body.password,
        ip: req.context?.ip ?? null,
        userAgent: req.context?.userAgent ?? null,
      });

      setSessionCookie(deps, res, outcome.token);

      const response: LoginResponse = {
        status: outcome.status,
        user: {
          id: outcome.user.id,
          email: outcome.user.email,
          displayName: outcome.user.displayName,
        },
      };
      // O token vai SOMENTE no cookie httpOnly; nunca no corpo da resposta.
      res.status(200).json(response);
    }),

    logout: asyncHandler(async (req, res) => {
      const session = requireSession(req);
      await revokeSession(deps, {
        userId: session.userId,
        sessionId: session.sessionId,
        reason: 'logout',
      });
      clearSessionCookie(deps, res);
      res.status(204).end();
    }),

    logoutAll: asyncHandler(async (req, res) => {
      const session = requireSession(req);
      const revoked = await revokeAllSessions(deps, {
        userId: session.userId,
        reason: 'logout_all',
      });
      clearSessionCookie(deps, res);
      res.status(200).json({ revoked });
    }),

    session: asyncHandler(async (req, res) => {
      const session = requireSession(req);

      const memberships = await withUser(deps.pool, { userId: session.userId }, async (client) => {
        const { rows } = await client.query<{
          tenant_id: string;
          tenant_slug: string;
          tenant_name: string;
          role: MembershipRole;
        }>('SELECT tenant_id, tenant_slug, tenant_name, role FROM app.my_memberships()');
        return rows;
      });

      // Uma pessoa pode ter varios papeis na mesma comunidade; a resposta
      // agrupa por comunidade.
      const byTenant = new Map<string, MembershipSummary>();
      for (const row of memberships) {
        const current = byTenant.get(row.tenant_id);
        if (current) {
          byTenant.set(row.tenant_id, {
            ...current,
            roles: [...current.roles, row.role],
          });
        } else {
          byTenant.set(row.tenant_id, {
            tenantId: row.tenant_id,
            tenantSlug: row.tenant_slug,
            tenantName: row.tenant_name,
            roles: [row.role],
          });
        }
      }

      const response: SessionResponse = {
        user: {
          id: session.userId,
          email: session.email,
          displayName: session.displayName,
        },
        mfaSatisfied: session.mfaSatisfied,
        mfaRequired: session.mfaRequired,
        mfaEnrolled: session.mfaEnrolled,
        platformRoles: [...session.platformRoles],
        platformPermissions: [...session.platformPermissions],
        memberships: [...byTenant.values()],
      };
      res.status(200).json(response);
    }),

    mfaEnrollStart: asyncHandler(async (req, res) => {
      const session = requireSession(req);
      const enrollment = await startMfaEnrollment(deps, {
        userId: session.userId,
        email: session.email,
      });
      // O segredo aparece UMA vez, na tela de cadastro. Nao volta a ser lido.
      res.status(200).json(enrollment);
    }),

    mfaEnrollConfirm: asyncHandler(async (req, res) => {
      const session = requireSession(req);
      const body = mfaCodeRequestSchema.parse(req.body);
      await confirmMfaEnrollment(deps, {
        userId: session.userId,
        sessionId: session.sessionId,
        code: body.code,
      });
      res.status(200).json({ status: 'authenticated' });
    }),

    mfaVerify: asyncHandler(async (req, res) => {
      const session = requireSession(req);
      const body = mfaCodeRequestSchema.parse(req.body);
      await verifyMfaForSession(deps, {
        userId: session.userId,
        sessionId: session.sessionId,
        code: body.code,
      });
      res.status(200).json({ status: 'authenticated' });
    }),
  };
}
