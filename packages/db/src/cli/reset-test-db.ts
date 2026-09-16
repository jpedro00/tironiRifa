import pg from 'pg';

const { Client } = pg;

/**
 * Recria o banco de TESTE do zero e aplica as migrations.
 *
 * Por que existe: o registro `schema_migrations` guarda o checksum de cada
 * migration aplicada, e o runner recusa rodar quando um arquivo ja aplicado
 * muda (prevencao do erro E6 — coluna e CHECK criadas por patch manual). Essa
 * guarda e correta, mas trava o banco quando a migration mudou legitimamente
 * durante o desenvolvimento, antes de existir producao.
 *
 * A saida certa NAO e afrouxar a guarda nem editar `schema_migrations` na mao:
 * e reconstruir o banco a partir do repositorio, que e a fonte da verdade.
 *
 * SEGURANCA: recusa qualquer banco cujo nome nao termine em `_test`. Este
 * script APAGA o banco inteiro.
 *
 * Uso:
 *   ADMIN_DATABASE_URL=... TEST_DATABASE_NAME=campaigns_test \
 *   MIGRATION_DATABASE_URL=... npm run db:reset-test -w @campaigns/db
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const adminUrl = requireEnv('ADMIN_DATABASE_URL');
  const databaseName = process.env['TEST_DATABASE_NAME']?.trim() || 'campaigns_test';

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(databaseName)) {
    throw new Error(`TEST_DATABASE_NAME invalido: ${databaseName}`);
  }
  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `Recusado: "${databaseName}" nao termina em "_test". ` +
        'Este script apaga o banco inteiro e so opera sobre bancos de teste.',
    );
  }

  const admin = new Client({ connectionString: adminUrl, application_name: 'campaigns-reset-test' });
  await admin.connect();
  try {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    console.log(`banco removido: ${databaseName}`);
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    console.log(`banco recriado: ${databaseName}`);

    for (const role of ['app_user', 'app_worker']) {
      const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
      if (exists.rowCount === 0) {
        throw new Error(`Papel "${role}" nao existe. Rode primeiro: npm run db:bootstrap`);
      }
      await admin.query(`GRANT CONNECT ON DATABASE "${databaseName}" TO ${role}`);
    }
  } finally {
    await admin.end();
  }

  const migrationUrl = requireEnv('MIGRATION_DATABASE_URL');
  const { migrate } = await import('../migrator.js');
  const result = await migrate(migrationUrl);
  console.log(`migrations aplicadas (${result.applied.length}):`);
  for (const filename of result.applied) console.log(`  + ${filename}`);

  console.log('\nbanco de teste pronto. Rode: npm test');
}

main().catch((error: unknown) => {
  console.error('reset falhou:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
