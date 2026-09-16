import { ApiClient } from '@campaigns/shared';

/**
 * Cliente da API da vitrine.
 *
 * A comunidade sai do DOMINIO em producao. Em localhost, onde nao existe
 * subdominio por comunidade, o slug pode vir de `?tenant=`. O navegador nunca
 * envia tenant_id: o servidor resolve o identificador.
 *
 * Dominio desconhecido nao cai em comunidade padrao — a API responde 404 e a
 * vitrine mostra "comunidade nao encontrada".
 */
function detectTenantSlug(): string | null {
  const host = window.location.hostname;
  const parts = host.split('.');
  if (parts.length >= 3 && parts[0] && parts[0] !== 'www') return parts[0];

  const fromQuery = new URLSearchParams(window.location.search).get('tenant');
  if (fromQuery) {
    window.localStorage.setItem('tenantSlug', fromQuery);
    return fromQuery;
  }
  return window.localStorage.getItem('tenantSlug');
}

export const apiBaseUrl: string =
  (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? 'http://localhost:3000';

export const api = new ApiClient({ baseUrl: apiBaseUrl, tenantSlug: detectTenantSlug() });
