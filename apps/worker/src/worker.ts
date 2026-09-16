import { createPool, type DbPool } from '@campaigns/db';
import type PgBoss from 'pg-boss';
import { loadWorkerConfig, type WorkerConfig } from './config.js';
import { FOUNDATION_QUEUE, startQueue, type QueueMessage } from './queue.js';
import { runRelayOnce, type Publisher } from './outbox/relay.js';
import { handleMessage } from './dispatch.js';

/**
 * Processo do worker.
 *
 * Duas engrenagens separadas:
 *   RELAY      le a outbox e entrega a fila. So isso.
 *   CONSUMIDOR tira da fila e executa, de forma idempotente.
 *
 * Nenhuma cobranca e nenhum envio comercial acontecem aqui: a fundacao nao
 * implementa pagamento nem mensagem. O unico consumidor da fase provisiona a
 * marca padrao de uma comunidade recem-criada.
 */

function buildPublisher(boss: PgBoss): Publisher {
  return async (event) => {
    const message: QueueMessage = {
      outboxEventId: event.id,
      tenantId: event.tenantId,
      eventType: event.eventType,
      payload: event.payload,
    };

    const jobId = await boss.send(FOUNDATION_QUEUE, message, {
      // A fila tambem tenta de novo. O consumidor e idempotente, entao repetir
      // e seguro.
      retryLimit: 5,
      retryDelay: 10,
      retryBackoff: true,
      // Chave estavel: mesmo evento nao vira dois jobs simultaneos.
      singletonKey: event.id,
    });

    if (jobId === null) {
      // `send` devolve null quando a fila recusa (por exemplo, por chave
      // singleton ja em voo). Nao e sucesso: deixar passar marcaria o evento
      // como publicado sem ter sido aceito.
      throw new Error(`A fila recusou o evento ${event.id}.`);
    }
  };
}

async function startConsumer(boss: PgBoss, pool: DbPool): Promise<void> {
  await boss.work<QueueMessage>(FOUNDATION_QUEUE, { batchSize: 10 }, async (jobs) => {
    for (const job of jobs) {
      await handleMessage(pool, job.data);
    }
  });
}

function startRelayLoop(
  pool: DbPool,
  publish: Publisher,
  config: WorkerConfig,
): { stop: () => void } {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const result = await runRelayOnce(pool, publish, {
        batchSize: config.OUTBOX_BATCH_SIZE,
        maxAttempts: config.OUTBOX_MAX_ATTEMPTS,
        retryBaseSeconds: config.OUTBOX_RETRY_BASE_SECONDS,
      });
      if (result.published > 0 || result.failed > 0 || result.exhausted > 0) {
        console.log(
          `[relay] publicados=${result.published} falhas=${result.failed} esgotados=${result.exhausted}`,
        );
      }
    } catch (error) {
      // O relay nao pode morrer por uma rodada ruim: a proxima tenta de novo.
      console.error('[relay] rodada falhou:', error);
    } finally {
      if (!stopped) {
        timer = setTimeout(() => void tick(), config.OUTBOX_POLL_INTERVAL_MS);
      }
    }
  };

  void tick();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

async function main(): Promise<void> {
  const config = loadWorkerConfig();

  const pool = createPool({
    connectionString: config.DATABASE_URL,
    applicationName: 'campaigns-worker',
    ssl: config.DATABASE_SSL,
  });

  const boss = await startQueue(config);
  await startConsumer(boss, pool);
  const relay = startRelayLoop(pool, buildPublisher(boss), config);

  console.log(`worker no ar (${config.NODE_ENV}); fila "${FOUNDATION_QUEUE}"`);

  const shutdown = (signal: string): void => {
    console.log(`recebido ${signal}, encerrando worker...`);
    relay.stop();
    void boss
      .stop({ graceful: true })
      .then(() => pool.end())
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
    setTimeout(() => process.exit(1), 15_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  console.error('worker falhou ao subir:', error);
  process.exitCode = 1;
});
