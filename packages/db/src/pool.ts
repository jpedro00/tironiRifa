import pg from 'pg';

const { Pool } = pg;

export type { PoolClient, QueryResult, QueryResultRow } from 'pg';
export type DbPool = pg.Pool;

/**
 * Datas vem do banco em UTC. O driver, por padrao, converte `timestamptz` para
 * um Date no fuso local do processo, o que faz a mesma linha "mudar de hora"
 * conforme a maquina. O DOC-01 secao 18 exige datas em UTC; entregamos o
 * texto ISO e deixamos a conversao para quem exibe.
 */
pg.types.setTypeParser(1184, (value: string) => value); // timestamptz
pg.types.setTypeParser(1114, (value: string) => value); // timestamp

/** `bigint` chega como string para nao perder precisao silenciosamente. */
pg.types.setTypeParser(20, (value: string) => value);

export interface CreatePoolOptions {
  readonly connectionString: string;
  readonly max?: number;
  readonly applicationName?: string;
  readonly ssl?: boolean;
}

export function createPool(options: CreatePoolOptions): DbPool {
  return new Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'campaigns-api',
    // Neon e provedores gerenciados exigem TLS; Postgres local normalmente nao.
    ...(options.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}
