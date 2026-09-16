# Divergências entre o DOC-01 e o código da NewStore

Registro de pontos marcados **NewStore** no DOC-01 em que o código de produção
diverge do documento. Pela ordem de autoridade do PROMPT_ASTRA, o código vence
nos itens marcados NewStore — mas a regra também diz, explicitamente, para
**não escolher sozinho**: a divergência fica registrada aqui e a decisão é do
produto.

## Situação do anexo A2

A análise da Fase 0 registrou o código da NewStore como **não disponível**.
Ele **está disponível** e foi consultado nesta rodada:

| Item | Localização |
|---|---|
| Backend | `~/Downloads/newstore-backend-main (21).zip` (255 arquivos) |
| Frontend | `~/Downloads/newstore-frontend-main (20).zip` |
| Engine | `~/Downloads/newstore-engine-main (14).zip` |
| Arquitetura original | `~/Downloads/arquitetura_plataforma_campanhas_comunidades.drawio` |

A consulta desta rodada foi **pontual**, limitada às constantes protegidas da
fundação. **Não houve varredura de paridade completa** e **nenhuma função foi
portada** — isso é trabalho da Fase 2.

---

## D01 · Prazo de reserva (RN05) — DIVERGÊNCIA ABERTA

**DOC-01:** `RESERVATION_TTL_MINUTES = 30`, marcado como paridade NewStore.
**PROMPT_ASTRA §4.1:** 30, constante protegida.
**D01 e PROMPT_GERAL:** supunham 10 minutos (conflito C01, já corrigido pelo DOC-01).

**O que o código da NewStore faz:** o prazo **não é constante** — é lido de
`process.env.RESERVATION_TTL_MIN`, e o *default* **difere entre rotas**:

| Arquivo | Default |
|---|---|
| `src/routes/additional_draws.js:9` | **30** |
| `src/routes/secondary_draws.js:10-12` | **30** |
| `src/routes/reservations.js:51` | **5** |
| `src/services/autopayRunner.js:2421` | **5** |
| `src/services/checkoutBatchService.js:396` | **5** |

Ou seja: nem 10, nem um valor único. A rota principal de reservas usa **5**
minutos por padrão; as rotas de sorteios adicionais e secundários usam **30**.

**O que foi implementado na Fase 1:** `RESERVATION_TTL_MINUTES = 30`, constante
não configurável por ambiente, protegida por teste
(`packages/shared/tests/protected-constants.test.ts`).

**Por que 30, e o que isso deixa em aberto:** o DOC-01 e o painel do Astra
fixam 30 e o pedido desta fase lista 30 entre as regras protegidas. Adotar 30
segue a instrução recebida. Mas isso **não resolve a divergência**: se o valor
que roda em produção hoje for 5 em `reservations.js`, a nova plataforma mudará
o comportamento que os participantes conhecem, e o contador visível na tela
passará a mostrar outro prazo.

**Decisão necessária antes da Fase 2:**
1. O valor de produção hoje é 5 ou 30? Depende de `RESERVATION_TTL_MIN` estar
   definido no ambiente da NewStore — o que não pode ser lido do código.
2. A divergência entre rotas é intencional (sorteio principal × adicional) ou é
   um defeito?
3. O prazo continua configurável por ambiente, ou vira constante?

Enquanto isso não for respondido, **não há paridade comprovada** neste item.

---

## D02 · Retenção de pré-autorização de cativo (RN16) — CONFIRMADO

**DOC-01:** retenção máxima de 12 horas.
**Código da NewStore:** `getCaptivePreauthExpiresHours()` em
`src/services/autopay/captivePreauthService.js:99-101` retorna
`process.env.CAPTIVE_PREAUTH_EXPIRES_HOURS || 12`.

**Resultado:** o default do código **confere** com o DOC-01.
`PREAUTHORIZATION_MAX_RETENTION_HOURS = 12` foi adotado e está protegido por
teste.

Observação: também aqui o valor é sobrescrevível por ambiente. A constante da
nova plataforma não é.

---

## D03 · Valor padrão do cativo (S10) — INFORMAÇÃO NOVA, NÃO ADOTADA

`getDefaultAuthorizedBaseAmountCents()` no mesmo arquivo retorna
`process.env.CAPTIVE_AUTOPAY_DEFAULT_AMOUNT_CENTS || 5500` — ou seja, **R$ 55,00**
como valor padrão autorizado por sorteio.

`shouldRequireCaptivePreauth()` confirma a regra do DOC-01: exige
pré-autorização quando `currentAmountCents > authorizedBaseAmountCents`
(estritamente maior).

**Não adotado nesta fase.** Cativos pertencem à Fase 8. O número fica
registrado como achado, não como regra: S10 continua aberta quanto a o valor
padrão ser por número ou por conjunto.

---

## Itens marcados NewStore ainda NÃO comparados com o código

Nenhum destes foi verificado nesta rodada. Continuam sem paridade comprovada:

- grade dinâmica e `label_digits` (RN13);
- rótulos com zeros à esquerda;
- PIX Mercado Pago e idempotência de webhook (RN06, RN07);
- campos de preço promocional (RN14);
- guardas de cobrança de cativo (RN15, RN17);
- thresholds 25 e 10 e mensagem de saldo (RN18, RN19);
- fechamento e os 25 cenários de D+1 (RN20, RN21);
- colunas e constraints herdadas de `draws`, `captive_*`, `preauthorizations`,
  `notifications_sent`.

A matriz de paridade completa é entregável da Fase 2, quando essas funções
forem efetivamente portadas.
