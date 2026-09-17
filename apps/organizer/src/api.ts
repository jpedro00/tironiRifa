import { ApiClient, detectTenantSlug } from '@campaigns/shared';

/**
 * Cliente da API.
 *
 * A comunidade e resolvida pelo SERVIDOR, a partir do dominio. O slug so viaja
 * do navegador quando o app roda em localhost, onde nao ha subdominio por
 * comunidade — e a API so o aceita com `TENANT_HEADER_ENABLED` ligado, o que
 * a configuracao recusa em producao. Em nenhum caso o cliente envia um
 * tenant_id: o identificador sai do banco e o vinculo e conferido la.
 *
 * A REGRA de onde o slug vem mora em `@campaigns/shared` e tem teste proprio;
 * aqui fica so a leitura do navegador.
 */
const STORAGE_KEY = 'tenantSlug';

function readStoredSlug(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Navegacao privada ou armazenamento bloqueado: seguir sem memoria e
    // melhor do que quebrar a pagina inteira.
    return null;
  }
}

function resolveTenantSlug(): string | null {
  const decision = detectTenantSlug({
    hostname: window.location.hostname,
    search: window.location.search,
    storedSlug: readStoredSlug(),
  });

  // O parametro `?tenant=` some na navegacao seguinte; memorizar e o que
  // mantem a escolha valendo durante a sessao de desenvolvimento.
  if (decision.source === 'query' && decision.slug) {
    try {
      window.localStorage.setItem(STORAGE_KEY, decision.slug);
    } catch {
      /* sem memoria disponivel; o parametro continua funcionando na URL */
    }
  }
  return decision.slug;
}

export const apiBaseUrl: string =
  (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? 'http://localhost:3000';

export const api = new ApiClient({ baseUrl: apiBaseUrl, tenantSlug: resolveTenantSlug() });

export function setTenantSlug(slug: string | null): void {
  try {
    if (slug) window.localStorage.setItem(STORAGE_KEY, slug);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* sem memoria disponivel */
  }
  api.setTenantSlug(slug);
}
