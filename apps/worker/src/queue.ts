import PgBoss from 'pg-boss';
import pg from 'pg';
import type { Publisher } from './outbox/relay.js';

const { Client } = pg;

/**
 * Fila de execucao (pg-boss).
 *
 * A fila NAO e a outbox. A outbox e o registro transacional do que aconteceu;
 * a fila e o mecanismo que executa o trabalho decorrente, com tentativa,
 * recuo e concorrencia.
 *
 * O pg-boss usa uma conexao propria (QUEUE_DATABASE_URL) porque mantem as
 * proprias tabelas e o proprio ciclo de vida de pool. Ela usa o MESMO papel
 * restrito do worker: o schema `pgboss` e criado pela migration com
 * `app_worker` como dono (0007/0008), entao criar as tabelas da fila ali e
 * exercicio de POSSE sobre o proprio schema — nao privilegio administrativo
 * sobre o banco. `app_worker` continua sem DDL no schema `public`, onde vivem
 * os dados de negocio, e continua sem BYPASSRLS.
 */
export const FOUNDATION_QUEUE = 'foundation-events';

export interface QueueMessage {
  /** Id da linha em `outbox`. E a chave de idempotencia do consumidor. */
  readonly outboxEventId: string;
  readonly tenantId: string | null;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
}

/**
 * O que a fila precisa saber para subir.
 *
 * Um recorte da configuracao do worker, em vez da configuracao inteira: assim o
 * teste de integracao sobe a MESMA funcao de producao apontando para um schema
 * proprio, sem precisar montar um ambiente completo nem duplicar esta logica.
 */
export interface QueueOptions {
  readonly QUEUE_DATABASE_URL: string;
  readonly QUEUE_SCHEMA: string;
  readonly DATABASE_SSL: boolean;
}

/**
 * INSTALACAO DA FILA — etapa administrativa, executada UMA vez.
 *
 * O pg-boss cria o proprio schema ao subir. O detalhe que decide a arquitetura
 * e este: `CREATE SCHEMA IF NOT EXISTS` exige `CREATE` no BANCO mesmo quando o
 * schema ja existe — o PostgreSQL verifica o privilegio antes de considerar o
 * `IF NOT EXISTS`. Ou seja, deixar o worker instalar a propria fila obrigaria a
 * dar privilegio de criacao no banco a um processo de execucao continua, para
 * um comando que ele so precisaria na primeira subida da vida.
 *
 * A separacao pedida fica entao explicita:
 *
 *   INSTALACAO (aqui)   papel administrativo, uma vez, junto das migrations;
 *   RUNTIME             `app_worker`, sem nenhum privilegio de DDL no banco.
 *
 * Depois de criar os objetos, a POSSE e transferida para o papel do worker. E
 * isso que permite ao pg-boss aplicar as proprias migrations de versao mais
 * tarde — alterar tabela que se possui nao exige privilegio no banco — sem que
 * o worker jamais possa criar um schema novo.
 */
export async function installQueue(input: {
  readonly adminConnectionString: string;
  readonly schema: string;
  readonly ownerRole: string;
  readonly ssl?: boolean;
}): Promise<{ created: boolean }> {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.schema)) {
    throw new Error(`Nome de schema invalido para a fila: ${input.schema}`);
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.ownerRole)) {
    throw new Error(`Nome de papel invalido para a fila: ${input.ownerRole}`);
  }

  const admin = new Client({
    connectionString: input.adminConnectionString,
    application_name: 'campaigns-queue-install',
    ...(input.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  await admin.connect();

  let created = false;
  try {
    /**
     * O DDL sai do plano ESTATICO da biblioteca, executado por um cliente
     * comum — nao de `boss.start()`.
     *
     * `start()` faria a mesma criacao, mas tambem subiria supervisor,
     * manutencao e pool: um instalador que precisa TERMINAR ficaria preso a
     * temporizadores de um processo feito para nao terminar. O plano estatico e
     * a mesma verdade da biblioteca, sem o runtime junto.
     */
    if (!(await queueIsInstalled(admin, input.schema))) {
      await admin.query(PgBoss.getConstructionPlans(input.schema));
      created = true;
    }

    // Posse de tudo o que a fila criou passa ao papel do worker. Sem isto, os
    // objetos ficariam do papel administrativo e o runtime precisaria de GRANTs
    // avulsos — que teriam de ser revistos a cada versao do pg-boss.
    await admin.query(`ALTER SCHEMA ${input.schema} OWNER TO ${input.ownerRole}`);
    await admin.query(`
      DO $$
      DECLARE
        obj record;
      BEGIN
        FOR obj IN
          SELECT c.relname, c.relkind
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = '${input.schema}'
             AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
        LOOP
          IF obj.relkind IN ('r', 'p') THEN
            EXECUTE format('ALTER TABLE %I.%I OWNER TO %I',
                           '${input.schema}', obj.relname, '${input.ownerRole}');
          ELSIF obj.relkind = 'S' THEN
            EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO %I',
                           '${input.schema}', obj.relname, '${input.ownerRole}');
          ELSE
            EXECUTE format('ALTER VIEW %I.%I OWNER TO %I',
                           '${input.schema}', obj.relname, '${input.ownerRole}');
          END IF;
        END LOOP;

        FOR obj IN
          SELECT p.oid::regprocedure AS sig
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = '${input.schema}'
        LOOP
          EXECUTE format('ALTER FUNCTION %s OWNER TO %I', obj.sig, '${input.ownerRole}');
        END LOOP;

        FOR obj IN
          SELECT t.typname
            FROM pg_type t
            JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = '${input.schema}' AND t.typtype = 'e'
        LOOP
          EXECUTE format('ALTER TYPE %I.%I OWNER TO %I',
                         '${input.schema}', obj.typname, '${input.ownerRole}');
        END LOOP;
      END;
      $$;
    `);
  } finally {
    await admin.end();
  }

  return { created };
}

/**
 * A fila ja foi instalada neste schema?
 *
 * `to_regclass` nao lanca quando o objeto nao existe — devolve NULL. Um
 * `SELECT ... FROM <schema>.version` lancaria, e distinguir "nao instalada" de
 * "sem privilegio" no texto do erro seria adivinhacao.
 */
async function queueIsInstalled(client: pg.Client, schema: string): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`${schema}.version`],
  );
  return rows[0]?.exists === true;
}

/**
 * Sobe a fila para o RUNTIME, com o papel restrito do worker.
 *
 * Recusa subir se a fila ainda nao foi instalada, em vez de tentar cria-la: a
 * criacao e etapa administrativa (ver `installQueue`), e deixar o worker
 * tropecar num "permission denied for database" cru esconderia o que de fato
 * falta fazer.
 */
export async function startQueue(config: QueueOptions): Promise<PgBoss> {
  const probe = new Client({
    connectionString: config.QUEUE_DATABASE_URL,
    application_name: 'campaigns-queue-probe',
    ...(config.DATABASE_SSL ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  await probe.connect();
  try {
    if (!(await queueIsInstalled(probe, config.QUEUE_SCHEMA))) {
      throw new Error(
        `A fila nao esta instalada no schema "${config.QUEUE_SCHEMA}".\n` +
          'Instalar cria objetos e exige papel administrativo — o worker roda ' +
          'com um papel restrito de proposito.\n' +
          'Rode uma vez, junto das migrations: npm run queue:install -w @campaigns/worker',
      );
    }
  } finally {
    await probe.end();
  }

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

/**
 * Publisher do relay: leva o evento da outbox ate a fila.
 *
 * Mora aqui, junto da fila, e nao no processo do worker, porque e conhecimento
 * de FILA — e porque o teste de integracao precisa exercitar exatamente este
 * codigo. Um publisher so montado dentro de `main()` seria, na pratica,
 * intestavel: a suite acabaria reimplementando o `send`, e o que ela provaria
 * seria a reimplementacao.
 */
export function buildPublisher(boss: PgBoss): Publisher {
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
      // Chave estavel: o mesmo evento nao vira dois jobs simultaneos.
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
