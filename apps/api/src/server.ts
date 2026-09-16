import { createPool } from '@campaigns/db';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { SecretBox } from './lib/secretBox.js';

/** Entrada do processo da API. */
function main(): void {
  const config = loadConfig();

  const pool = createPool({
    connectionString: config.DATABASE_URL,
    applicationName: 'campaigns-api',
    ssl: config.DATABASE_SSL,
  });

  const app = createApp({
    config,
    pool,
    secretBox: new SecretBox(config.MFA_ENCRYPTION_KEY),
  });

  const server = app.listen(config.PORT, () => {
    console.log(`API ouvindo em http://localhost:${config.PORT} (${config.NODE_ENV})`);
  });

  // Encerramento limpo: para de aceitar conexoes novas e fecha o pool, para
  // nao deixar transacao pela metade num deploy.
  const shutdown = (signal: string): void => {
    console.log(`recebido ${signal}, encerrando...`);
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
