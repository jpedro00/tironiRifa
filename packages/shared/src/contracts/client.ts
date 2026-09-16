import {
  ROUTE_CONTRACTS,
  type RouteName,
  type AuditListResponse,
  type CreateTenantRequest,
  type HealthResponse,
  type LoginRequest,
  type LoginResponse,
  type MfaCodeRequest,
  type MfaEnrollStartResponse,
  type MfaVerifyResponse,
  type PublicTenantBranding,
  type SessionResponse,
  type TenantContextResponse,
  type TenantListResponse,
} from './routes.js';
import { API_ERROR_MESSAGES, type ApiErrorBody, type ApiErrorCode } from './errors.js';

/**
 * Cliente HTTP tipado, compartilhado pelos tres frontends.
 *
 * E4 - contrato frontend/backend: a chamada e feita por NOME de contrato, nao
 * por string de caminho. Um nome inexistente e erro de compilacao — o build
 * quebra antes de qualquer deploy, e nao em producao com um 404.
 */

/** Resposta de cada rota. */
export interface RouteResponses {
  health: HealthResponse;
  publicTenantBranding: PublicTenantBranding;
  login: LoginResponse;
  logout: void;
  logoutAll: { revoked: number };
  session: SessionResponse;
  mfaEnrollStart: MfaEnrollStartResponse;
  mfaEnrollConfirm: MfaVerifyResponse;
  mfaVerify: MfaVerifyResponse;
  tenantContext: TenantContextResponse;
  tenantAudit: AuditListResponse;
  platformTenants: TenantListResponse;
  platformCreateTenant: {
    id: string;
    slug: string;
    name: string;
    status: string;
    createdAt: string;
  };
}

/** Corpo esperado por rota. Rotas ausentes daqui nao recebem corpo. */
export interface RouteBodies {
  login: LoginRequest;
  mfaEnrollConfirm: MfaCodeRequest;
  mfaVerify: MfaCodeRequest;
  platformCreateTenant: CreateTenantRequest;
}

export type RouteBody<N extends RouteName> = N extends keyof RouteBodies
  ? RouteBodies[N]
  : undefined;

/** Erro de API com o codigo do contrato, para a interface decidir a tela. */
export class ApiClientError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(input: { code: ApiErrorCode; message: string; status: number; details?: unknown }) {
    super(input.message);
    this.name = 'ApiClientError';
    this.code = input.code;
    this.status = input.status;
    this.details = input.details;
  }
}

export interface ApiClientOptions {
  readonly baseUrl: string;
  /**
   * Comunidade pedida, por SLUG. Nunca por tenant_id: o servidor resolve o
   * identificador e confere o vinculo. Em producao a comunidade sai do
   * dominio; o cabecalho existe para o desenvolvimento em localhost.
   */
  readonly tenantSlug?: string | null;
}

export interface RequestOptions {
  readonly query?: Record<string, string | number | undefined>;
  readonly signal?: AbortSignal;
}

function buildUrl(
  baseUrl: string,
  path: string,
  query: RequestOptions['query'],
): string {
  const url = new URL(path, baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as ApiErrorBody).error?.code === 'string'
  );
}

export class ApiClient {
  readonly #baseUrl: string;
  #tenantSlug: string | null;

  constructor(options: ApiClientOptions) {
    this.#baseUrl = options.baseUrl;
    this.#tenantSlug = options.tenantSlug ?? null;
  }

  setTenantSlug(slug: string | null): void {
    this.#tenantSlug = slug;
  }

  get tenantSlug(): string | null {
    return this.#tenantSlug;
  }

  /**
   * Chama uma rota pelo nome do contrato.
   *
   * `credentials: 'include'` faz o cookie httpOnly de sessao viajar. O token
   * nunca e lido nem guardado pelo JavaScript da pagina.
   */
  async call<N extends RouteName>(
    name: N,
    body?: RouteBody<N>,
    options?: RequestOptions,
  ): Promise<RouteResponses[N]> {
    const contract = ROUTE_CONTRACTS[name];

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (contract.tenantScope === 'resolved' && this.#tenantSlug) {
      headers['x-tenant-slug'] = this.#tenantSlug;
    }

    const response = await fetch(buildUrl(this.#baseUrl, contract.path, options?.query), {
      method: contract.method,
      headers,
      credentials: 'include',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(options?.signal ? { signal: options.signal } : {}),
    });

    if (response.status === 204) {
      return undefined as RouteResponses[N];
    }

    const text = await response.text();
    const parsed: unknown = text === '' ? null : JSON.parse(text);

    if (!response.ok) {
      if (isApiErrorBody(parsed)) {
        throw new ApiClientError({
          code: parsed.error.code,
          message: parsed.error.message,
          status: response.status,
          details: parsed.error.details,
        });
      }
      throw new ApiClientError({
        code: 'INTERNAL',
        message: API_ERROR_MESSAGES.INTERNAL,
        status: response.status,
      });
    }

    return parsed as RouteResponses[N];
  }
}
