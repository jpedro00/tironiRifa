import type { PoolClient } from '@campaigns/db';

/**
 * M12 · trilha de auditoria. RN11.
 *
 * Recebe o CLIENT da transacao, nunca o pool: a trilha e gravada na MESMA
 * transacao da acao auditada. Se a acao sofrer rollback, a trilha nao fica
 * afirmando que algo aconteceu.
 *
 * Senha, token e segredo nao entram em `before`/`after`. Alem da disciplina no
 * chamador, o banco recusa chaves sensiveis (app.assert_no_secrets, 0001).
 */
export interface AuditInput {
  /** NULO para acao de plataforma, que nao pertence a nenhuma comunidade. */
  readonly tenantId: string | null;
  readonly actorUserId: string | null;
  readonly actorType?: 'USER' | 'PLATFORM' | 'SYSTEM';
  readonly action: string;
  readonly targetType?: string | null;
  readonly targetId?: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export async function recordAuditEvent(client: PoolClient, input: AuditInput): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO audit_events
       (tenant_id, actor_user_id, actor_type, action, target_type, target_id, before, after, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::inet, $10)
     RETURNING id`,
    [
      input.tenantId,
      input.actorUserId,
      input.actorType ?? 'USER',
      input.action,
      input.targetType ?? null,
      input.targetId ?? null,
      input.before === undefined ? null : JSON.stringify(input.before),
      input.after === undefined ? null : JSON.stringify(input.after),
      input.ip ?? null,
      input.userAgent ?? null,
    ],
  );
  return rows[0]!.id;
}

export interface AuditEventRow {
  id: string;
  occurred_at: string;
  action: string;
  actor_user_id: string | null;
  target_type: string | null;
  target_id: string | null;
  ip: string | null;
}

/**
 * Lista a trilha da comunidade do contexto.
 *
 * `before` e `after` NAO sao devolvidos nesta listagem: podem conter dado
 * pessoal do comprador, e ler a trilha nao e o mesmo direito que ler dado
 * pessoal (DOC-01 secao 3 separa os dois).
 */
export async function listTenantAuditEvents(
  client: PoolClient,
  options: { limit: number },
): Promise<AuditEventRow[]> {
  const { rows } = await client.query<AuditEventRow>(
    `SELECT id, occurred_at, action, actor_user_id, target_type, target_id, host(ip) AS ip
       FROM audit_events
      ORDER BY occurred_at DESC
      LIMIT $1`,
    [Math.min(Math.max(options.limit, 1), 200)],
  );
  return rows;
}
