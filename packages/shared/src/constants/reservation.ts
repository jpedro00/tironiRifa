/**
 * Constantes protegidas de reserva.
 *
 * DOC-01 (introducao + RN05) e PROMPT_ASTRA secao 4.1.
 *
 * O D01 e o PROMPT_GERAL supunham 10 minutos; o DOC-01 corrige explicitamente
 * para 30 e marca o comportamento como paridade NewStore. O valor NAO e
 * configuravel por ambiente: e uma constante de negocio protegida por teste
 * (packages/shared/tests/protected-constants.test.ts).
 *
 * DIVERGENCIA REGISTRADA (nao resolvida silenciosamente) - ver
 * docs/parity/newstore-divergences.md: o codigo da NewStore le
 * `process.env.RESERVATION_TTL_MIN` com defaults inconsistentes entre rotas
 * (30 em additional_draws.js e secondary_draws.js; 5 em reservations.js,
 * autopayRunner.js e checkoutBatchService.js). O DOC-01 e o painel Astra
 * fixam 30. A Fase 1 adota 30 e mantem a divergencia aberta para a Fase 2.
 */
export const RESERVATION_TTL_MINUTES = 30 as const;

/** DOC-01: reserva com preco promocional usa o mesmo prazo da reserva comum. */
export const PROMOTIONAL_RESERVATION_TTL_MINUTES = 30 as const;

/**
 * Retencao maxima de pre-autorizacao de cliente cativo, em horas.
 * DOC-01 secao 8/10 e RN16. Confirmado no codigo da NewStore:
 * `getCaptivePreauthExpiresHours()` em src/services/autopay/captivePreauthService.js
 * retorna 12 como default.
 */
export const PREAUTHORIZATION_MAX_RETENTION_HOURS = 12 as const;
