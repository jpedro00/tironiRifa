import { z } from 'zod';

/**
 * Configuracao da API.
 *
 * Toda variavel e validada na subida. Um segredo ausente derruba o processo em
 * vez de o sistema subir com um padrao inseguro.
 *
 * Nenhum segredo tem valor padrao embutido: credencial de banco e chave de
 * cifragem existem no ambiente ou o processo nao sobe (PROMPT_ASTRA, principio 9).
 */
const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  /** Conexao da API: papel RESTRITO app_user, nunca o dono do schema. */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL e obrigatoria.'),
  DATABASE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  /**
   * Chave de cifragem dos segredos TOTP, 32 bytes em base64.
   * Gerar com: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   */
  MFA_ENCRYPTION_KEY: z
    .string()
    .min(1, 'MFA_ENCRYPTION_KEY e obrigatoria.')
    .refine((value) => {
      try {
        return Buffer.from(value, 'base64').length === 32;
      } catch {
        return false;
      }
    }, 'MFA_ENCRYPTION_KEY deve ser 32 bytes em base64.'),

  /** Dominio base das vitrines: {slug}.{APP_BASE_DOMAIN}. */
  APP_BASE_DOMAIN: z.string().min(1).default('plataforma.local'),

  /**
   * Aceitar o cabecalho `x-tenant-slug` para escolher a comunidade.
   *
   * PADRAO: DESLIGADO. O cabecalho e um seletor de comunidade controlado pelo
   * CLIENTE. Com ele ligado, qualquer requisicao, vinda de qualquer host,
   * escolhe a comunidade que quiser — e a promessa de que "dominio
   * desconhecido devolve 404" deixa de valer, porque o host passa a ser
   * irrelevante.
   *
   * Existe apenas para o desenvolvimento em localhost, onde os tres frontends
   * rodam sem subdominio por comunidade. Em producao fica desligado e a
   * comunidade sai exclusivamente do dominio.
   *
   * Ligar em producao e recusado na carga da configuracao (refine abaixo).
   */
  TENANT_HEADER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  /** Origens permitidas para os tres frontends, separadas por virgula. */
  CORS_ORIGINS: z.string().default(''),

  SESSION_COOKIE_NAME: z.string().default('campaigns_session'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  SESSION_COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  /** Bloqueio por tentativas de login. */
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),

  /** Emissor exibido no aplicativo autenticador. */
  MFA_ISSUER: z.string().default('Campanhas & Comunidades'),
});

export type AppConfig = Readonly<z.infer<typeof configSchema>> & {
  readonly corsOrigins: readonly string[];
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema
    .refine(
      (value) => !(value.NODE_ENV === 'production' && value.TENANT_HEADER_ENABLED),
      {
        message:
          'TENANT_HEADER_ENABLED nao pode ser true em producao: o cabecalho deixaria o cliente escolher a comunidade, ignorando o dominio.',
        path: ['TENANT_HEADER_ENABLED'],
      },
    )
    .safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuracao invalida:\n${issues}`);
  }

  const corsOrigins = parsed.data.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');

  return Object.freeze({ ...parsed.data, corsOrigins: Object.freeze(corsOrigins) });
}
