import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'vitest/config';

// As TEST_*_DATABASE_URL vivem no `.env` da raiz. Sem isto, os testes de banco
// se auto-pulariam por "falta de configuracao" mesmo com o arquivo presente —
// e um teste pulado em silencio parece um teste aprovado.
// `override: false`: variavel ja no ambiente (CI) tem precedencia.
const rootEnv = resolve(__dirname, '.env');
if (existsSync(rootEnv)) {
  loadDotenv({ path: rootEnv, override: false });
}

export default defineConfig({
  test: {
    // Testes de banco compartilham um PostgreSQL real; rodar em serie evita
    // que um teste de isolamento derrube o schema de outro.
    fileParallelism: false,
    include: [
      'packages/**/tests/**/*.test.ts',
      'apps/api/tests/**/*.test.ts',
      'apps/worker/tests/**/*.test.ts',
    ],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
