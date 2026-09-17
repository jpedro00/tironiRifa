/**
 * De onde sai o slug da comunidade, no navegador.
 *
 * O CLIENTE NUNCA ENVIA UM `tenant_id`. Ele envia, no maximo, um NOME. O
 * identificador sai do banco e o vinculo e conferido la (RN01).
 *
 * EM PRODUCAO a comunidade sai do DOMINIO, no servidor — este slug e
 * irrelevante, porque a API ignora o cabecalho `x-tenant-slug` a menos que
 * `TENANT_HEADER_ENABLED` esteja ligado, e a configuracao recusa liga-lo em
 * producao. O caminho existe para o desenvolvimento em localhost, onde os tres
 * frontends rodam sem subdominio por comunidade.
 *
 * Funcao PURA: recebe o que leu do navegador e devolve a decisao. Ler
 * `window` e gravar no `localStorage` fica com quem chama. E o que permite
 * testar a regra sem um DOM.
 */
export interface TenantSlugSources {
  /** `window.location.hostname`. */
  readonly hostname: string;
  /** `window.location.search`. */
  readonly search: string;
  /** Slug memorizado de uma visita anterior, se houver. */
  readonly storedSlug: string | null;
}

export interface TenantSlugDecision {
  readonly slug: string | null;
  /**
   * De onde veio. `query` e o unico caso que o chamador deve MEMORIZAR: o
   * parametro some na navegacao seguinte, e sem memoria a escolha se perderia
   * a cada clique.
   */
  readonly source: 'subdomain' | 'query' | 'stored' | 'none';
}

export function detectTenantSlug(sources: TenantSlugSources): TenantSlugDecision {
  const host = sources.hostname.trim().toLowerCase();
  const parts = host.split('.');

  // {slug}.dominio-base — o formato de producao.
  if (parts.length >= 3 && parts[0] && parts[0] !== 'www') {
    return { slug: parts[0], source: 'subdomain' };
  }

  const fromQuery = new URLSearchParams(sources.search).get('tenant')?.trim().toLowerCase();
  if (fromQuery) {
    return { slug: fromQuery, source: 'query' };
  }

  const stored = sources.storedSlug?.trim().toLowerCase();
  if (stored) {
    return { slug: stored, source: 'stored' };
  }

  // Sem slug NAO e erro aqui: em producao o servidor resolve pelo dominio.
  // Domino desconhecido vira 404 la, nunca uma comunidade padrao.
  return { slug: null, source: 'none' };
}
