import { defineConfig } from 'vitest/config';

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
