import type { DbPool } from '@campaigns/db';
import type { AppConfig } from './config.js';
import type { SecretBox } from './lib/secretBox.js';

/** Dependencias injetadas nas rotas. Facilita trocar o pool nos testes. */
export interface AppDeps {
  readonly config: AppConfig;
  readonly pool: DbPool;
  readonly secretBox: SecretBox;
}
