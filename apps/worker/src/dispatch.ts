import type { DbPool } from '@campaigns/db';
import type { QueueMessage } from './queue.js';
import { provisionTenantBranding } from './consumers/provisionTenantBranding.js';

/**
 * Roteamento da mensagem para o consumidor correspondente.
 *
 * Fica num modulo proprio para que os testes exercitem o consumo real sem
 * subir o processo do worker, abrir a fila ou tocar a rede.
 */
export async function handleMessage(pool: DbPool, message: QueueMessage): Promise<void> {
  switch (message.eventType) {
    case 'tenant.created':
      await provisionTenantBranding(pool, {
        eventId: message.outboxEventId,
        payload: message.payload,
      });
      return;

    case 'membership.granted':
    case 'membership.revoked':
      // Registrados no catalogo da fundacao e gravados na outbox, mas sem
      // consumidor nesta fase. Reconhecer sem agir e melhor do que inventar um
      // efeito que a especificacao nao pediu.
      return;

    default:
      // Evento desconhecido nao e descartado silenciosamente: falhar faz a
      // fila tentar de novo e deixa o problema visivel.
      throw new Error(`Evento sem consumidor: ${message.eventType}`);
  }
}
