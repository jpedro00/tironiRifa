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
    /**
     * Tempo limite por teste.
     *
     * 30s basta com PostgreSQL local, onde uma ida e volta custa menos de um
     * milissegundo. Contra um banco GERENCIADO em outra regiao, a mesma suite
     * paga latencia real: da maquina de quem desenvolve ate `us-west-2` cada
     * conexao custa segundos, e um teste que faz seis logins — cada um com
     * `scrypt` e varias consultas — estoura 30s sem que nada esteja errado.
     *
     * Aumentar o limite NAO enfraquece assercao nenhuma: o que muda e quanto
     * tempo se espera pela rede, nao o que se exige do sistema. Por isso e
     * variavel de ambiente, e nao um numero maior fixo: quem roda local
     * continua descobrindo lentidao de verdade em 30s.
     *
     * Este custo e da BANCADA, nao da aplicacao: em producao a API roda na
     * mesma regiao do banco, e a ida e volta volta a ser de milissegundos.
     */
    testTimeout: Number(process.env['VITEST_TEST_TIMEOUT_MS'] ?? 30_000),
    hookTimeout: Number(process.env['VITEST_HOOK_TIMEOUT_MS'] ?? 60_000),
  },
});
