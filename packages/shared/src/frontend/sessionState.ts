import { ApiClientError } from '../contracts/client.js';
import type { SessionResponse } from '../contracts/routes.js';

/**
 * Decisoes de sessao dos frontends, em um lugar so.
 *
 * Os tres frontends faziam as MESMAS duas perguntas, cada um com a propria
 * copia da resposta: "o que esta sessao ainda precisa?" e "este erro significa
 * que a pessoa saiu?". Copias divergem — e divergiram: a vitrine e os paineis
 * ja tratavam o segundo fator de formas diferentes.
 *
 * Aqui e logica pura, sem React e sem DOM. E por isso que ela pode ser testada
 * de verdade, sem montar componente nem trazer um ambiente de navegador para a
 * suite.
 */

/**
 * O que a sessao ainda precisa antes de ser utilizavel.
 *
 * `mfa_enrollment_required` e `mfa_required` sao estados DIFERENTES porque
 * levam a telas diferentes: cadastrar um fator novo, ou digitar o codigo de um
 * fator que ja existe.
 */
export type SessionNeed = 'nothing' | 'mfa_enrollment' | 'mfa_code';

/**
 * RN12, do lado do cliente.
 *
 * Duas perguntas independentes, e e a combinacao que decide:
 *   - o perfil EXIGE segundo fator (`mfaRequired`)?
 *   - esta sessao COMPROVOU um segundo fator (`mfaSatisfied`)?
 *
 * Quem tem fator cadastrado por escolha propria tambem precisa usa-lo, mesmo
 * sem obrigacao de perfil — cadastrar e declarar que aquele fator faz parte do
 * acesso.
 *
 * Isto NAO e controle de acesso: o backend decide sozinho e nao confia nesta
 * funcao. O que ela evita e uma tela sem saida, onde o painel abre e toda
 * chamada volta 403.
 */
export function sessionNeed(session: {
  mfaRequired: boolean;
  mfaSatisfied: boolean;
  mfaEnrolled: boolean;
}): SessionNeed {
  if (session.mfaSatisfied) return 'nothing';
  if (session.mfaEnrolled) return 'mfa_code';
  if (session.mfaRequired) return 'mfa_enrollment';
  return 'nothing';
}

/** Conveniencia: a sessao esta pronta para uso? */
export function isSessionUsable(session: SessionResponse): boolean {
  return sessionNeed(session) === 'nothing';
}

/**
 * Por que a leitura da sessao falhou.
 *
 *   'unauthenticated' · o servidor RESPONDEU que nao ha sessao valida.
 *   'unavailable'     · nao houve resposta utilizavel: rede fora, servidor
 *                       fora, resposta ilegivel.
 */
export type SessionFailure = 'unauthenticated' | 'unavailable';

/**
 * Distingue "a pessoa nao esta logada" de "nao consegui perguntar".
 *
 * Tratar os dois como o mesmo caso e um erro com consequencia visivel: uma
 * queda de rede de tres segundos derruba a interface para a tela de login, e a
 * pessoa reentra achando que a sessao expirou — quando ela nunca deixou de
 * existir. Pior, num formulario aberto, o trabalho em tela se perde.
 *
 * Somente 401 e 403 de autenticacao significam "saiu". Um 500 e uma falha do
 * servidor; um `TypeError` de `fetch` e a rede. Nenhum dos dois autoriza
 * concluir coisa alguma sobre a sessao.
 */
export function classifySessionFailure(error: unknown): SessionFailure {
  if (error instanceof ApiClientError) {
    if (error.code === 'UNAUTHENTICATED') return 'unauthenticated';
    // 5xx e o servidor falhando, nao a sessao terminando.
    if (error.status >= 500) return 'unavailable';
    // Demais 4xx de autorizacao nao dizem que a sessao acabou; dizem que
    // aquela rota nao e permitida. A sessao continua de pe.
    return error.status === 401 ? 'unauthenticated' : 'unavailable';
  }
  return 'unavailable';
}
