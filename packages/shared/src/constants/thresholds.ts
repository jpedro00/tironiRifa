/**
 * Avisos de numeros restantes. DOC-01 secao 11 e RN18. Paridade NewStore.
 *
 * "faltando X" = total_numbers - numeros PAGOS.
 * RESERVADO e CATIVO PENDENTE nunca contam como vendidos.
 */
export const DEFAULT_REMAINING_THRESHOLDS = [25, 10] as const;

export type DefaultThreshold = (typeof DEFAULT_REMAINING_THRESHOLDS)[number];
