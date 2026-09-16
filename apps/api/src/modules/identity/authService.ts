import { withUser, withoutContext } from '@campaigns/db';
import {
  platformPermissionsFor,
  requiresMfa,
  type MembershipRole,
  type PlatformRole,
} from '@campaigns/shared';
import type { AppDeps } from '../../deps.js';
import { ApiError } from '../../lib/apiError.js';
import { verifyPassword } from '../../lib/password.js';
import { generateSessionToken, hashSessionToken } from '../../lib/sessionToken.js';
import { buildOtpauthUri, generateTotpSecret, verifyTotp } from '../../lib/totp.js';
import type { AuthenticatedSession } from '../../middleware/types.js';

/** M01 · Identidade, autenticacao, sessao e segundo fator. RN12. */

interface LoginCredentialRow {
  user_id: string;
  email: string;
  display_name: string;
  user_status: string;
  password_hash: string;
  locked_until: string | null;
  failed_attempts: number;
}

export interface LoginOutcome {
  readonly status: 'authenticated' | 'mfa_required' | 'mfa_enrollment_required';
  readonly token: string;
  readonly user: { id: string; email: string; displayName: string };
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

/**
 * Perfis do usuario, usados para decidir se RN12 obriga segundo fator.
 * Le por funcoes SECURITY DEFINER que filtram pelo usuario do CONTEXTO.
 */
async function loadProfile(
  deps: AppDeps,
  userId: string,
): Promise<{
  platformRoles: PlatformRole[];
  tenantRoles: MembershipRole[];
  mfaEnrolled: boolean;
}> {
  return withUser(deps.pool, { userId }, async (client) => {
    const platform = await client.query<{ role: PlatformRole }>(
      'SELECT role FROM app.my_platform_roles()',
    );
    const memberships = await client.query<{ role: MembershipRole }>(
      'SELECT role FROM app.my_memberships()',
    );
    const factor = await client.query(
      `SELECT 1 FROM user_mfa_factors
        WHERE user_id = $1 AND factor_type = 'TOTP' AND confirmed_at IS NOT NULL`,
      [userId],
    );
    return {
      platformRoles: platform.rows.map((row) => row.role),
      tenantRoles: memberships.rows.map((row) => row.role),
      mfaEnrolled: (factor.rowCount ?? 0) > 0,
    };
  });
}

export async function login(deps: AppDeps, input: LoginInput): Promise<LoginOutcome> {
  const email = input.email.trim().toLowerCase();

  const credential = await withoutContext(deps.pool, async (client) => {
    const { rows } = await client.query<LoginCredentialRow>(
      `SELECT user_id, email, display_name, user_status, password_hash, locked_until, failed_attempts
         FROM app.find_login_credential($1)`,
      [email],
    );
    return rows[0] ?? null;
  });

  // Mesma resposta para "e-mail nao existe" e "senha errada": distinguir os
  // dois casos entrega uma lista de e-mails validos a quem esta tentando.
  const genericFailure = ApiError.unauthenticated('E-mail ou senha inválidos.');

  if (!credential) {
    // Gasta tempo comparavel a uma verificacao real, para o tempo de resposta
    // nao revelar que o e-mail nao existe.
    await verifyPassword(input.password, 'scrypt$32768$8$1$AAAA$AAAA');
    throw genericFailure;
  }

  if (credential.locked_until && new Date(credential.locked_until) > new Date()) {
    throw ApiError.rateLimited('Conta temporariamente bloqueada por tentativas de acesso.');
  }

  if (credential.user_status !== 'ACTIVE') {
    throw genericFailure;
  }

  const passwordOk = await verifyPassword(input.password, credential.password_hash);

  await withoutContext(deps.pool, async (client) => {
    await client.query('SELECT app.record_login_attempt($1, $2, $3, $4)', [
      credential.user_id,
      passwordOk,
      deps.config.LOGIN_MAX_ATTEMPTS,
      deps.config.LOGIN_LOCK_MINUTES,
    ]);
  });

  if (!passwordOk) {
    throw genericFailure;
  }

  const profile = await loadProfile(deps, credential.user_id);
  const mfaRequired = requiresMfa({
    tenantRoles: profile.tenantRoles,
    platformRoles: profile.platformRoles,
  });

  /**
   * Regra do segundo fator na abertura da sessao:
   *   - fator confirmado na conta  -> a sessao NASCE sem MFA satisfeito, mesmo
   *     que o perfil nao obrigue. Quem cadastrou o fator quer usa-lo.
   *   - sem fator, mas RN12 obriga -> sessao sem MFA satisfeito e status
   *     'mfa_enrollment_required'. A sessao existe apenas para permitir o
   *     cadastro do fator; nao abre nada privilegiado.
   *   - sem fator e sem obrigacao  -> sessao ja satisfeita (nao existe segundo
   *     fator a satisfazer).
   */
  let status: LoginOutcome['status'];
  let mfaSatisfied: boolean;

  if (profile.mfaEnrolled) {
    status = 'mfa_required';
    mfaSatisfied = false;
  } else if (mfaRequired) {
    status = 'mfa_enrollment_required';
    mfaSatisfied = false;
  } else {
    status = 'authenticated';
    mfaSatisfied = true;
  }

  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + deps.config.SESSION_TTL_HOURS * 3600 * 1000);

  await withUser(deps.pool, { userId: credential.user_id }, async (client) => {
    await client.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at, mfa_satisfied_at, ip, user_agent)
       VALUES ($1, $2, $3, CASE WHEN $4 THEN now() ELSE NULL END, $5::inet, $6)`,
      [
        credential.user_id,
        tokenHash,
        expiresAt.toISOString(),
        mfaSatisfied,
        input.ip,
        input.userAgent,
      ],
    );
  });

  return {
    status,
    token,
    user: {
      id: credential.user_id,
      email: credential.email,
      displayName: credential.display_name,
    },
  };
}

interface SessionRow {
  session_id: string;
  user_id: string;
  mfa_satisfied_at: string | null;
  expires_at: string;
  user_status: string;
  email: string;
  display_name: string;
}

/**
 * Valida o token e monta a sessao.
 *
 * `app.authenticate_session` ja recusa sessao revogada ou expirada. A
 * revogacao, portanto, vale na requisicao seguinte — nao espera expiracao.
 */
export async function authenticateSession(
  deps: AppDeps,
  token: string,
): Promise<AuthenticatedSession | null> {
  if (!token) return null;

  const row = await withoutContext(deps.pool, async (client) => {
    const { rows } = await client.query<SessionRow>(
      `SELECT session_id, user_id, mfa_satisfied_at, expires_at, user_status, email, display_name
         FROM app.authenticate_session($1)`,
      [hashSessionToken(token)],
    );
    return rows[0] ?? null;
  });

  if (!row) return null;

  const profile = await loadProfile(deps, row.user_id);
  const platformPermissions = platformPermissionsFor(profile.platformRoles);

  await withUser(deps.pool, { userId: row.user_id }, async (client) => {
    await client.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [row.session_id]);
  });

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    mfaSatisfied: row.mfa_satisfied_at !== null,
    mfaRequired: requiresMfa({
      tenantRoles: profile.tenantRoles,
      platformRoles: profile.platformRoles,
    }),
    mfaEnrolled: profile.mfaEnrolled,
    platformRoles: profile.platformRoles,
    platformPermissions,
  };
}

export async function revokeSession(
  deps: AppDeps,
  input: { userId: string; sessionId: string; reason: string },
): Promise<void> {
  await withUser(deps.pool, { userId: input.userId }, async (client) => {
    await client.query(
      `UPDATE sessions
          SET revoked_at = now(), revoked_reason = $2
        WHERE id = $1 AND revoked_at IS NULL`,
      [input.sessionId, input.reason],
    );
  });
}

/** Revoga TODAS as sessoes do usuario. Usado no "sair de todos os aparelhos". */
export async function revokeAllSessions(
  deps: AppDeps,
  input: { userId: string; reason: string },
): Promise<number> {
  return withUser(deps.pool, { userId: input.userId }, async (client) => {
    const result = await client.query(
      `UPDATE sessions
          SET revoked_at = now(), revoked_reason = $2
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [input.userId, input.reason],
    );
    return result.rowCount ?? 0;
  });
}

// ---------------------------------------------------------------------------
// Segundo fator (TOTP). RN12.
// ---------------------------------------------------------------------------

export interface MfaEnrollment {
  readonly secret: string;
  readonly otpauthUri: string;
}

/**
 * Inicia o cadastro do segundo fator.
 *
 * O segredo e gravado CIFRADO e ainda NAO confirmado. Um fator sem
 * `confirmed_at` nao satisfaz MFA e nao bloqueia o login — se a pessoa perder
 * o aplicativo no meio do cadastro, ela nao fica trancada para fora.
 *
 * Cadastros anteriores nao confirmados sao descartados, para nao deixar
 * segredos orfaos acumulados.
 */
export async function startMfaEnrollment(
  deps: AppDeps,
  input: { userId: string; email: string },
): Promise<MfaEnrollment> {
  const secret = generateTotpSecret();
  const encrypted = deps.secretBox.encrypt(secret);

  await withUser(deps.pool, { userId: input.userId }, async (client) => {
    const confirmed = await client.query(
      `SELECT 1 FROM user_mfa_factors
        WHERE user_id = $1 AND factor_type = 'TOTP' AND confirmed_at IS NOT NULL`,
      [input.userId],
    );
    if ((confirmed.rowCount ?? 0) > 0) {
      throw ApiError.conflict('A verificação em duas etapas já está ativa nesta conta.');
    }

    await client.query(
      `DELETE FROM user_mfa_factors
        WHERE user_id = $1 AND factor_type = 'TOTP' AND confirmed_at IS NULL`,
      [input.userId],
    );
    await client.query(
      `INSERT INTO user_mfa_factors (user_id, factor_type, secret_encrypted)
       VALUES ($1, 'TOTP', $2)`,
      [input.userId, encrypted],
    );
  });

  return {
    secret,
    otpauthUri: buildOtpauthUri({
      issuer: deps.config.MFA_ISSUER,
      accountName: input.email,
      secret,
    }),
  };
}

interface FactorRow {
  id: string;
  secret_encrypted: Buffer;
  confirmed_at: string | null;
  last_used_step: string | null;
}

/**
 * Confirma o cadastro com um codigo valido e marca a sessao como satisfeita.
 * Confirmar exige provar que o aplicativo esta gerando o codigo certo.
 */
export async function confirmMfaEnrollment(
  deps: AppDeps,
  input: { userId: string; sessionId: string; code: string },
): Promise<void> {
  await withUser(deps.pool, { userId: input.userId }, async (client) => {
    const { rows } = await client.query<FactorRow>(
      `SELECT id, secret_encrypted, confirmed_at, last_used_step
         FROM user_mfa_factors
        WHERE user_id = $1 AND factor_type = 'TOTP' AND confirmed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [input.userId],
    );
    const factor = rows[0];
    if (!factor) {
      throw ApiError.badRequest('Nenhum cadastro de segundo fator em andamento.');
    }

    const secret = deps.secretBox.decrypt(factor.secret_encrypted);
    const verification = verifyTotp({ token: input.code, secret });
    if (!verification.valid) {
      throw ApiError.unauthenticated('Código inválido.');
    }

    await client.query(
      `UPDATE user_mfa_factors
          SET confirmed_at = now(), last_used_at = now(), last_used_step = $2
        WHERE id = $1`,
      [factor.id, verification.timeStep],
    );
    await client.query('UPDATE sessions SET mfa_satisfied_at = now() WHERE id = $1', [
      input.sessionId,
    ]);
  });
}

/**
 * Satisfaz o segundo fator na sessao atual. RN12.
 *
 * Tres protecoes, nesta ordem:
 *
 *  1. BLOQUEIO POR TENTATIVAS. Um codigo TOTP tem 10^6 combinacoes, e quem
 *     chega aqui ja acertou a senha e tem sessao aberta. Sem limite, o segundo
 *     fator seria apenas um atraso de minutos.
 *
 *  2. ANTI-REPLAY. `afterTimeStep` recusa qualquer passo menor ou igual ao
 *     ultimo aceito: um codigo interceptado nao vale de novo dentro dos 30 s.
 *
 *  3. MARCACAO POR SESSAO. `mfa_satisfied_at` fica na SESSAO, nao no usuario:
 *     abrir outra sessao exige passar pelo fator outra vez.
 *
 * A contagem da tentativa falha e gravada em transacao SEPARADA, e so depois o
 * erro e lancado. Incrementar e lancar dentro da mesma transacao desfaria o
 * incremento no rollback — e o bloqueio nunca chegaria a acontecer.
 */
export async function verifyMfaForSession(
  deps: AppDeps,
  input: { userId: string; sessionId: string; code: string },
): Promise<void> {
  // --- 1. A conta esta bloqueada? ---
  const lockedUntil = await withUser(deps.pool, { userId: input.userId }, async (client) => {
    const { rows } = await client.query<{ mfa_locked_until: string | null }>(
      'SELECT mfa_locked_until FROM user_credentials WHERE user_id = $1',
      [input.userId],
    );
    return rows[0]?.mfa_locked_until ?? null;
  });

  if (lockedUntil && new Date(lockedUntil) > new Date()) {
    throw ApiError.rateLimited('Muitas tentativas de verificação. Aguarde e tente novamente.');
  }

  // --- 2. Verificar o codigo ---
  type Outcome =
    | { readonly kind: 'ok' }
    | { readonly kind: 'no_factor' }
    | { readonly kind: 'invalid' };

  const outcome = await withUser<Outcome>(deps.pool, { userId: input.userId }, async (client) => {
    const { rows } = await client.query<FactorRow>(
      `SELECT id, secret_encrypted, confirmed_at, last_used_step
         FROM user_mfa_factors
        WHERE user_id = $1 AND factor_type = 'TOTP' AND confirmed_at IS NOT NULL
        LIMIT 1
        FOR UPDATE`,
      [input.userId],
    );
    const factor = rows[0];
    if (!factor) return { kind: 'no_factor' };

    const secret = deps.secretBox.decrypt(factor.secret_encrypted);
    const verification = verifyTotp({
      token: input.code,
      secret,
      afterTimeStep: factor.last_used_step === null ? null : Number(factor.last_used_step),
    });

    if (!verification.valid) return { kind: 'invalid' };

    // Acertou: zera o contador, marca o passo usado e satisfaz a sessao —
    // tudo na mesma transacao.
    await client.query(
      `UPDATE user_credentials
          SET mfa_failed_attempts = 0, mfa_locked_until = NULL, updated_at = now()
        WHERE user_id = $1`,
      [input.userId],
    );
    await client.query(
      'UPDATE user_mfa_factors SET last_used_at = now(), last_used_step = $2 WHERE id = $1',
      [factor.id, verification.timeStep],
    );
    await client.query('UPDATE sessions SET mfa_satisfied_at = now() WHERE id = $1', [
      input.sessionId,
    ]);

    return { kind: 'ok' };
  });

  if (outcome.kind === 'ok') return;
  if (outcome.kind === 'no_factor') throw ApiError.mfaEnrollmentRequired();

  // --- 3. Tentativa falha: contar em transacao propria, depois recusar ---
  await withUser(deps.pool, { userId: input.userId }, async (client) => {
    await client.query(
      `UPDATE user_credentials
          SET mfa_failed_attempts = mfa_failed_attempts + 1,
              mfa_locked_until = CASE
                WHEN mfa_failed_attempts + 1 >= $2
                  THEN now() + make_interval(mins => $3)
                ELSE mfa_locked_until
              END,
              updated_at = now()
        WHERE user_id = $1`,
      [input.userId, deps.config.LOGIN_MAX_ATTEMPTS, deps.config.LOGIN_LOCK_MINUTES],
    );
  });

  throw ApiError.unauthenticated('Código inválido ou já utilizado.');
}
