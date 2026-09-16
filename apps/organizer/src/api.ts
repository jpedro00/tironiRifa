import { ApiClient } from '@campaigns/shared';

/**
 * Cliente da API do painel.
 *
 * A comunidade e resolvida pelo SERVIDOR, a partir do dominio. O slug so viaja
 * do navegador quando o painel roda em localhost, onde nao ha subdominio por
 * comunidade. Em nenhum caso o cliente envia um tenant_id: o identificador sai
 * do banco e o vinculo e conferido la.
 */
function detectTenantSlug(): string | null {
  const host = window.location.hostname;

  // Producao: {slug}.dominio-base
  const parts = host.split('.');
  if (parts.length >= 3 && parts[0] && parts[0] !== 'www') {
    return parts[0];
  }

  // Desenvolvimento: ?tenant=slug, memorizado para a navegacao seguinte.
  const fromQuery = new URLSearchParams(window.location.search).get('tenant');
  if (fromQuery) {
    window.localStorage.setItem('tenantSlug', fromQuery);
    return fromQuery;
  }
  return window.localStorage.getItem('tenantSlug');
}

export const apiBaseUrl: string =
  (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? 'http://localhost:3000';

export const api = new ApiClient({
  baseUrl: apiBaseUrl,
  tenantSlug: detectTenantSlug(),
});

export function setTenantSlug(slug: string | null): void {
  if (slug) window.localStorage.setItem('tenantSlug', slug);
  else window.localStorage.removeItem('tenantSlug');
  api.setTenantSlug(slug);
}
