import { describe, expect, it } from 'vitest';
import {
  ApiClientError,
  classifySessionFailure,
  detectTenantSlug,
  isSessionUsable,
  sessionNeed,
  type SessionResponse,
} from '../src/index.js';

/**
 * Logica de fundacao dos TRES frontends.
 *
 * O que esta coberto aqui e o que pode causar regressao grave sem aparecer no
 * typecheck: decidir se a sessao esta pronta (RN12 na tela), decidir se um erro
 * significa que a pessoa saiu, e decidir de onde vem o slug da comunidade.
 *
 * O que NAO esta coberto, e deliberadamente: a RENDERIZACAO dos componentes.
 * Testar React exigiria trazer jsdom e uma biblioteca de testes de componente
 * para a suite, e o pedido desta rodada e explicito em nao adicionar esse peso.
 * A consequencia esta registrada no README: as telas em si nao tem teste
 * automatizado nesta fase.
 */

function session(partial: Partial<SessionResponse> = {}): SessionResponse {
  return {
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'p@example.com', displayName: 'P' },
    mfaSatisfied: false,
    mfaRequired: false,
    mfaEnrolled: false,
    platformRoles: [],
    platformPermissions: [],
    memberships: [],
    ...partial,
  };
}

describe('frontend · RN12 na tela', () => {
  it('sem obrigacao e sem fator, nao ha nada pendente', () => {
    // Marketing, suporte e operador: entram e usam o painel.
    expect(sessionNeed(session())).toBe('nothing');
    expect(isSessionUsable(session())).toBe(true);
  });

  it('perfil obrigado sem fator cadastrado precisa CADASTRAR', () => {
    expect(sessionNeed(session({ mfaRequired: true }))).toBe('mfa_enrollment');
  });

  it('com fator cadastrado, precisa do CODIGO — mesmo sem obrigacao de perfil', () => {
    // Cadastrar um fator e declarar que ele faz parte do acesso.
    expect(sessionNeed(session({ mfaEnrolled: true }))).toBe('mfa_code');
    expect(sessionNeed(session({ mfaEnrolled: true, mfaRequired: true }))).toBe('mfa_code');
  });

  it('fator comprovado encerra a pendencia', () => {
    expect(
      sessionNeed(session({ mfaRequired: true, mfaEnrolled: true, mfaSatisfied: true })),
    ).toBe('nothing');
  });

  it('promocao de papel reabre a pendencia sem novo login', () => {
    // A sessao nasce com mfaSatisfied=false; quando o perfil passa a exigir
    // MFA, a tela acompanha o backend na requisicao seguinte.
    const antes = session();
    expect(sessionNeed(antes)).toBe('nothing');

    const depois = session({ mfaRequired: true });
    expect(sessionNeed(depois)).toBe('mfa_enrollment');
  });
});

describe('frontend · erro de rede nao e logout', () => {
  function apiError(code: ApiClientError['code'], status: number): ApiClientError {
    return new ApiClientError({ code, message: 'mensagem qualquer', status });
  }

  it('401 do servidor significa que a sessao acabou', () => {
    expect(classifySessionFailure(apiError('UNAUTHENTICATED', 401))).toBe('unauthenticated');
  });

  it('falha de rede NAO significa que a sessao acabou', () => {
    // `fetch` rejeita com TypeError quando nao ha resposta.
    expect(classifySessionFailure(new TypeError('Failed to fetch'))).toBe('unavailable');
  });

  it('500 do servidor NAO significa que a sessao acabou', () => {
    expect(classifySessionFailure(apiError('INTERNAL', 500))).toBe('unavailable');
  });

  it('403 de permissao NAO significa que a sessao acabou', () => {
    // Faltar permissao para uma rota nao encerra a sessao.
    expect(classifySessionFailure(apiError('FORBIDDEN', 403))).toBe('unavailable');
    expect(classifySessionFailure(apiError('MFA_REQUIRED', 403))).toBe('unavailable');
  });

  it('erro desconhecido nao e tratado como logout', () => {
    expect(classifySessionFailure(undefined)).toBe('unavailable');
    expect(classifySessionFailure({ qualquer: 'coisa' })).toBe('unavailable');
  });
});

describe('frontend · de onde vem o slug da comunidade', () => {
  const vazio = { hostname: 'localhost', search: '', storedSlug: null };

  it('subdominio tem precedencia: e o formato de producao', () => {
    expect(detectTenantSlug({ ...vazio, hostname: 'minha.plataforma.local' })).toEqual({
      slug: 'minha',
      source: 'subdomain',
    });
  });

  it('www nao e comunidade', () => {
    expect(detectTenantSlug({ ...vazio, hostname: 'www.plataforma.local' }).source).not.toBe(
      'subdomain',
    );
  });

  it('em localhost, ?tenant= escolhe e pede para ser memorizado', () => {
    const decision = detectTenantSlug({ ...vazio, search: '?tenant=minha-comunidade' });
    expect(decision).toEqual({ slug: 'minha-comunidade', source: 'query' });
  });

  it('sem parametro, vale o slug memorizado', () => {
    expect(detectTenantSlug({ ...vazio, storedSlug: 'guardada' })).toEqual({
      slug: 'guardada',
      source: 'stored',
    });
  });

  it('o parametro tem precedencia sobre o memorizado', () => {
    const decision = detectTenantSlug({
      ...vazio,
      search: '?tenant=nova',
      storedSlug: 'antiga',
    });
    expect(decision.slug).toBe('nova');
  });

  it('sem nenhuma fonte, nao inventa comunidade', () => {
    // Nao existe comunidade padrao: quem resolve e o servidor, pelo dominio, e
    // dominio desconhecido vira 404 la.
    expect(detectTenantSlug(vazio)).toEqual({ slug: null, source: 'none' });
  });

  it('normaliza caixa: o slug e minusculo no banco', () => {
    expect(detectTenantSlug({ ...vazio, search: '?tenant=MinhaComunidade' }).slug).toBe(
      'minhacomunidade',
    );
    expect(detectTenantSlug({ ...vazio, hostname: 'MINHA.plataforma.local' }).slug).toBe('minha');
  });

  it('o slug e apenas um NOME — nunca um identificador', () => {
    // Uma tentativa de passar um UUID continua sendo so um texto: o servidor
    // resolve pelo slug e confere o vinculo. Isto documenta a fronteira.
    const decision = detectTenantSlug({
      ...vazio,
      search: '?tenant=11111111-1111-4111-8111-111111111111',
    });
    expect(decision.slug).toBe('11111111-1111-4111-8111-111111111111');
    expect(decision.source).toBe('query');
  });
});
