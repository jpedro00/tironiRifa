import PgBoss from 'pg-boss';
import type { WorkerConfig } from './config.js';

/**
 * Fila de execucao (pg-boss).
 *
 * A fila NAO e a outbox. A outbox e o registro transacional do que aconteceu;
 * a fila e o mecanismo que executa o trabalho decorrente, com tentativa,
 * recuo e concorrencia.
 *
 * O pg-boss usa uma conexao propria (QUEUE_DATABASE_URL) porque mantem o
 * proprio schema e precisa de privilegio de criacao. O papel que toca dado de
 * negocio (`app_worker`) nao recebe esse privilegio.
 */
export const FOUNDATION_QUEUE = 'foundation-events';

export interface QueueMessage {
  /** Id da linha em `outbox`. E a chave de idempotencia do consumidor. */
  readonly outboxEventId: string;
  readonly tenantId: string | null;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
}

export async function startQueue(config: WorkerConfig): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: config.QUEUE_DATABASE_URL,
    schema: config.QUEUE_SCHEMA,
    ...(config.DATABASE_SSL ? { ssl: { rejectUnauthorized: true } } : {}),
  });

  boss.on('error', (error) => {
    console.error('[fila] erro:', error);
  });

  await boss.start();
  await boss.createQueue(FOUNDATION_QUEUE);
  return boss;
}
