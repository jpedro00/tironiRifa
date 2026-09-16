import { ApiClient } from '@campaigns/shared';

/**
 * Cliente da API do console da plataforma.
 *
 * O console NAO resolve comunidade: ele opera no eixo de PLATAFORMA. Nenhuma
 * chamada daqui carrega slug de comunidade, e nenhum privilegio de plataforma
 * vem de um papel de comunidade.
 */
export const apiBaseUrl: string =
  (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? 'http://localhost:3000';

export const api = new ApiClient({ baseUrl: apiBaseUrl, tenantSlug: null });
