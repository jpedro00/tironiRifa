import pg from 'pg';

const { Client } = pg;

/**
 * Bootstrap do banco: cria o banco de dados e os DOIS papeis restritos que a
 * aplicacao usa.
 *
 * Fica fora das migrations de proposito. Criar papel exige privilegio
 * administrativo e envolve SENHA — e senha nao entra em arquivo versionado.
 *
 * Variaveis de ambiente:
 *   ADMIN_DATABASE_URL   conexao administrativa (ex.: postgres://postgres:...@localhost:5432/postgres)
 *   DATABASE_NAME        banco a criar (padrao: campaigns)
 *   APP_DB_PASSWORD      senha do papel app_user
 *   WORKER_DB_PASSWORD   senha do papel app_worker
 *
 * Uso:
 *   npm run db:bootstrap
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
  }
  return value;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function main(): Promise<void> {
  const adminUrl = requireEnv('ADMIN_DATABASE_URL');
  const databaseName = process.env['DATABASE_NAME']?.trim() || 'campaigns';
  const appPassword = requireEnv('APP_DB_PASSWORD');
  const workerPassword = requireEnv('WORKER_DB_PASSWORD');

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(databaseName)) {
    throw new Error(`DATABASE_NAME invalido: ${databaseName}`);
  }

  const admin = new Client({ connectionString: adminUrl, application_name: 'campaigns-bootstrap' });
  await admin.connect();

  try {
    // ---- banco ----
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      databaseName,
    ]);
    if (existing.rowCount === 0) {
      // CREATE DATABASE nao aceita parametro e nao roda em transacao.
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      console.log(`banco criado: ${databaseName}`);
    } else {
      console.log(`banco ja existe: ${databaseName}`);
    }

    // ---- papeis ----
    // NOSUPERUSER / NOCREATEDB / NOCREATEROLE / NOBYPASSRLS sao explicitos:
    // um papel com BYPASSRLS tornaria toda a RLS decorativa, e o teste de
    // isolamento passaria sem provar nada.
    for (const [role, password] of [
      ['app_user', appPassword],
      ['app_worker', workerPassword],
    ] as const) {
      const roleExists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
      if (roleExists.rowCount === 0) {
        await admin.query(
          `CREATE ROLE ${role} LOGIN PASSWORD ${quoteLiteral(password)} ` +
            'NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
        );
        console.log(`papel criado: ${role}`);
      } else {
        await admin.query(`ALTER ROLE ${role} PASSWORD ${quoteLiteral(password)}`);
        await admin.query(
          `ALTER ROLE ${role} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
        );
        console.log(`papel ja existia, senha e atributos atualizados: ${role}`);
      }
      await admin.query(`GRANT CONNECT ON DATABASE "${databaseName}" TO ${role}`);
    }
  } finally {
    await admin.end();
  }

  console.log('\nbootstrap concluido. Proximo passo: npm run db:migrate');
}

main().catch((error: unknown) => {
  console.error('bootstrap falhou:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
