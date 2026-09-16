import { z } from 'zod';

/**
 * Configuracao do worker.
 *
 * DUAS conexoes, de proposito:
 *
 *   DATABASE_URL        papel `app_worker`. Le a outbox, grava
 *                       `event_consumptions` e executa o efeito do consumidor.
 *                       Nao e dono de tabela e nao tem BYPASSRLS.
 *
 *   QUEUE_DATABASE_URL  usada APENAS pelo pg-boss. A fila cria e mantem o
 *                       proprio schema, o que exige privilegio de criacao —
 *                       privilegio que o papel de negocio nao deve ter.
 *
 * Separar as duas impede que a infraestrutura de fila obrigue o papel que toca
 * dado de negocio a receber permissao de DDL.
 */
const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL e obrigatoria.'),
  QUEUE_DATABASE_URL: z.string().min(1, 'QUEUE_DATABASE_URL e obrigatoria.'),
  DATABASE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  /** Intervalo da varredura da outbox, em milissegundos. */
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),
  /** Eventos publicados por rodada. */
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().max(500).default(50),
  /** Tentativas do relay antes de o evento ir para inspecao manual. */
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  /** Base do recuo exponencial entre tentativas, em segundos. */
  OUTBOX_RETRY_BASE_SECONDS: z.coerce.number().int().positive().default(5),

  QUEUE_SCHEMA: z.string().default('pgboss'),
});

export type WorkerConfig = Readonly<z.infer<typeof configSchema>>;

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuracao do worker invalida:\n${issues}`);
  }
  return Object.freeze(parsed.data);
}
