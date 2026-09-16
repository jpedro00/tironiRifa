# Fase 1 — Decisões e suposições

Toda decisão que não estava definida nos anexos aparece aqui com o prefixo
**Suposição**. Decisões que apenas aplicam o que os documentos determinam
aparecem como **Decisão**.

---

## 1. Identidade global — a exceção mais importante desta fase

**Conflito (C16):** o DOC-01 §18 diz que "todas as tabelas de negócio têm
`tenant_id`". O DOC-01 §3 diz que "o mesmo usuário pode ter papéis diferentes
em comunidades diferentes". As duas frases não cabem juntas na tabela de login:
uma pessoa tem uma credencial e participa de N comunidades.

**Decisão — explícita, não escondida numa policy:**

| Tabela | `tenant_id`? | Por quê |
|---|---|---|
| `users` | **não** | identidade global |
| `user_credentials` | **não** | segredo da identidade |
| `user_mfa_factors` | **não** | segredo da identidade |
| `sessions` | **não** | sessão é da pessoa, não da comunidade |
| `platform_admins` | **não** | privilégio de plataforma |
| `memberships` | **sim** | é o vínculo, e é onde o isolamento começa |
| `tenant_branding`, `tenant_domains` | **sim** | dado da comunidade |
| `audit_events`, `outbox` | **nulável** | `NULL` = evento de plataforma |

**Como o acesso é restringido apesar de não haver `tenant_id`** (migration
`0005`): `users` tem RLS ativa e a policy só libera (a) o próprio usuário,
(b) quem tem vínculo vigente na comunidade resolvida no momento, (c) acesso de
plataforma verificado. Sem isso, "não ter `tenant_id`" significaria que o papel
da aplicação leria a base inteira de usuários.

**Testado em** `packages/db/tests/tenant-isolation.test.ts`: no contexto de A,
o usuário de B não é legível, e o segredo de MFA de outra pessoa não é legível
nem pelo dono da comunidade.

---

## 2. Autenticação

**Suposição:** os anexos exigem autenticação real e MFA (RN12) mas não escolhem
biblioteca nem provedor. Escolhas desta fase:

| Peça | Escolha | Motivo |
|---|---|---|
| Senha | `scrypt` do `node:crypto` | KDF com custo de memória, recomendada pelo OWASP, mantida pelo próprio runtime. bcrypt e argon2 exigem binário nativo, que quebra com frequência em Windows e em CI enxuto. Parâmetros gravados dentro do hash permitem aumentar o custo depois sem migration. |
| Segundo fator | `otplib` v13 (TOTP, RFC 6238) | Mantida, sem binário nativo, compatível com os autenticadores usuais. Traz proteção de replay nativa via `afterTimeStep`. |
| Sessão | Token opaco de 32 bytes, SHA-256 no banco, cookie httpOnly | A fase exige **revogação**. Um JWT autocontido continua valendo até expirar; revogar exigiria uma lista de bloqueio — ou seja, a consulta ao banco que o JWT queria evitar. |
| Segredo TOTP | AES-256-GCM, chave no ambiente | GCM é autenticado: registro adulterado falha em vez de devolver lixo. Um dump do banco não gera códigos válidos. |

**Consequência operacional:** perder `MFA_ENCRYPTION_KEY` invalida todos os
segundos fatores cadastrados. Isso precisa entrar no procedimento de operação.

---

## 3. Tabelas auxiliares — por que cada uma é indispensável

O pedido manda incluir as auxiliares da autenticação escolhida **explicando sua
necessidade**:

- **`user_credentials`** — separada de `users` para que (a) o hash nunca entre
  num `SELECT` de perfil por acidente, (b) o bloqueio por tentativas não
  escreva na linha de identidade lida por toda a aplicação, (c) a credencial
  possa ser rotacionada sem tocar no histórico da identidade.
- **`user_mfa_factors`** — o segredo TOTP tem ciclo de vida próprio
  (cadastrado → confirmado → revogado), independente da senha. `last_used_step`
  impede replay do mesmo código dentro dos 30 s.
- **`sessions`** — sem ela não existe logout nem revogação. `mfa_satisfied_at`
  é **por sessão**: ter o fator cadastrado não basta; RN12 exige ter passado
  pelo fator *nesta* sessão.
- **`platform_admins`** — privilégio de plataforma concedido um a um. Nenhuma
  linha aqui nasce como efeito de virar dono de comunidade.
- **`tenant_domains`** — estrutura para domínio próprio (DOC-01 §2, passo 6).
  `verified_at IS NULL` não resolve: registrar o domínio não prova posse.
- **`event_consumptions`** — idempotência do consumidor. Ver item 6.

---

## 4. Contexto de tenant e RLS

**Decisão:** o contexto vai por `set_config(..., true)` — **local à transação** —
dentro de `withContext` (`packages/db/src/context.ts`). Nunca `SET` comum.

Motivo: `SET LOCAL` morre no COMMIT/ROLLBACK. Uma conexão devolvida ao pool e
reaproveitada por outra requisição **não** carrega o tenant anterior. Com `SET`
comum, carregaria — e a requisição seguinte leria dados da comunidade errada.

**Defesa extra:** `RESET ALL` antes de devolver a conexão ao pool, caso algum
código futuro use `SET` em vez de `SET LOCAL`.

**Ausência de contexto nega:** `current_setting('app.tenant_id', true)` devolve
NULL, `tenant_id = NULL` é NULL, nenhuma linha passa. Não existe fallback para
comunidade padrão.

**Suposição — `app.platform_access`:** a RLS reconhece acesso de plataforma por
um GUC que a API liga somente depois de verificar papel de plataforma **e** MFA
satisfeito. A RLS aqui é defesa em profundidade contra consulta sem filtro; a
decisão de autorização vive na API e tem teste próprio. A aplicação pode, em
tese, ligar o GUC por conta própria — isso é o limite do modelo, e está
registrado em vez de ser apresentado como garantia.

**Integridade entre comunidades:** `memberships` e `tenant_domains` ganharam
chave composta `UNIQUE (tenant_id, id)`, para que as tabelas de negócio das
próximas fases possam referenciar `(tenant_id, x_id)` em conjunto. Um FK
simples por id deixaria uma linha de A apontar para um registro de B.

---

## 5. Papéis

**Suposição:** os códigos persistidos ficam em inglês (`OWNER`, `FINANCE`,
`MARKETING`, `SUPPORT`, `OPERATOR`), com rótulos em português na interface.

Justificativa: a restrição de "nomes fixos" do DOC-01 e do PROMPT_ASTRA cobre
os **estados de sorteio e de número** e as **colunas de grade e preço** —
o DOC-01 apresenta os papéis apenas como rótulos de tabela. Os estados, esses
sim, foram preservados literalmente em português, com acento e espaço.

**Decisão — "olho / só status" vira permissão separada.** A matriz do DOC-01 §3
distingue "ver pagamentos e conciliação" de "só status". Viraram
`payment:read:full` e `payment:read:status`. `buyer:read:full` é um terceiro
eixo, independente dos dois. Assim:
- Suporte vê o comprador e **não** vê conciliação nem estorna;
- Operador vê status do pagamento e **não** vê dados do comprador.

**Suposição (S8 aberta) — matriz do Super Admin.** O DOC-01 §17 nomeia as
áreas (Revisão, Risco, Cobranças, Saúde) mas não publica matriz por
sub-perfil. A distribuição adotada é conservadora: cada sub-perfil recebe
apenas a sua área, mais leitura de saúde. Nenhum recebe tudo. Precisa de
validação do produto.

**Decisão:** papel de comunidade **nunca** concede permissão de plataforma, e
vice-versa. Testado nos dois sentidos.

---

## 6. Outbox × fila — a distinção que mais se erra

**Decisão explícita:**

- A **outbox** é o *registro transacional* do que aconteceu, gravado pela API
  na mesma transação da mudança. Rollback apaga o evento junto.
- A **fila** (pg-boss) é o *mecanismo de execução*.
- O **relay** só leva o evento do registro até a fila. `published_at` significa
  "entreguei à fila" — **nada além disso**. Não significa trabalho concluído.
- A conclusão de cada consumidor vive em **`event_consumptions`**, outra
  tabela, com outra chave `(event_id, consumer)`.

**Garantia real: AO MENOS UMA VEZ.** Se a fila aceitar e o COMMIT que marca
`published_at` falhar, o evento será republicado. Não há promessa de "exatamente
uma vez" para efeito externo, e **nenhuma constraint sozinha produziria isso**.
O que impede efeito duplicado é a idempotência do consumidor.

**Evento real usado para verificar o fluxo:** `tenant.created` → consumidor
`provision-tenant-branding`, que provisiona a marca padrão. O consumidor
reivindica o evento em `event_consumptions` e executa o efeito **na mesma
transação**; reprocessar colide na chave primária e não repete.

**Não há cobrança nem envio comercial** no worker desta fase.

---

## 7. Enum único (prevenção do erro E3)

**Decisão:** os tipos `draw_status` e `draw_number_status` são criados **na
fundação** (`0002_shared_enums.sql`), embora as tabelas `draws` e
`draw_numbers` pertençam à Fase 2.

Motivo: E3 aconteceu porque havia dois vocabulários — um no código, outro no
banco — evoluindo em separado, até uma CHECK desatualizada bloquear inserts de
reserva. Criar o vocabulário antes das tabelas, com teste comparando `pg_enum`
com o array de `packages/shared`, é o que impede as duas listas de divergirem.

O teste `packages/db/tests/enum-parity.test.ts` falha nos dois sentidos e ainda
verifica que `'CATIVO PENDENTE'` é aceito e `'CATIVO_PENDENTE'` é recusado.

---

## 8. Redis × PostgreSQL (C03) — registrado, não implementado

O DOC-01 §9 e o D01 desenham Redis para a trava de reserva. O painel do
PROMPT_ASTRA escolhe, para a fase inicial, **só PostgreSQL**: transação +
índice único parcial.

**Nada de reserva foi implementado nesta fase.** A opção fica registrada para a
Fase 2, junto com o alerta de que a escolha diverge do desenho da referência
principal e precisa de decisão consciente — não de precedência automática.

---

## 9. Pendências que seguem abertas

Nenhuma delas impediu construir a fundação; nenhuma foi resolvida inventando
regra:

| Código | Pendência |
|---|---|
| C06 | Pausa de cativos: §7 e §10 divergem. |
| C07 / S1 | `ESTORNADO` terminal × retorno a `LIVRE`. Implementado como terminal; a volta não virou regra. |
| S3 / S4 | Pagamento após expiração, fechamento ou snapshot. |
| C09 | Consentimento por evento e canal. |
| S5 | Algoritmo para grade de 500 e número não vendido. |
| C11 | Edição de imagens durante revisão. |
| C12 | `campaign_versions` × `draw_versions`. |
| C13 | Rotas de reserva divergentes. |
| C22 | Limite monetário da segunda aprovação de estorno — nenhum valor arbitrário foi adotado. |
| C24 | Recorrência SaaS (M11) sem contrato completo. |
| S6 | `AGENDADA` continua identificada como suposição. Está no catálogo de estados; a ativação **não** foi implementada. |
| S8 | Matriz detalhada do Super Admin. |

---

## 10. Defeitos encontrados na execução com PostgreSQL real e corrigidos

A primeira execução da suíte com banco real (202 testes) expôs quatro defeitos.
Dois eram das asserções; **dois eram da implementação** e valiam correção.

### D-1 · Cabeçalho `x-tenant-slug` aceito fora de desenvolvimento — IMPLEMENTAÇÃO

**Observado:** host desconhecido + cabeçalho `x-tenant-slug` devolvia **200**
onde deveria devolver 404.

**Por que era grave:** o cabeçalho é um seletor de comunidade **controlado pelo
cliente**. Aceito incondicionalmente, qualquer requisição — de qualquer host —
escolhia a comunidade que quisesse, e a regra "domínio desconhecido devolve
404" virava letra morta, porque o host deixava de importar. Isso contraria
diretamente "não confie em `tenant_id` arbitrário enviado pelo cliente": um
slug de cabeçalho é a mesma coisa com outro nome.

Os painéis autenticados continuavam protegidos (o vínculo é sempre conferido
no banco), mas `/api/public/tenant` não tem checagem de vínculo — a marca de
qualquer comunidade podia ser lida de qualquer host.

**Correção:** nova chave `TENANT_HEADER_ENABLED`, **desligada por padrão**. Com
ela desligada o cabeçalho é ignorado por completo. A carga da configuração
**recusa** `true` com `NODE_ENV=production`. Coberto por
`host desconhecido NAO e salvo pelo cabecalho quando ele esta desligado`.

### D-2 · Origem HTTP desconhecida não era recusada — IMPLEMENTAÇÃO

**Observado:** origem fora da lista seguia executando; a resposta só omitia os
cabeçalhos CORS.

**Por que era grave:** omitir os cabeçalhos impede o navegador de **ler** a
resposta, mas a requisição **já foi executada no servidor**. Numa API
autenticada por cookie, uma escrita vinda de um site qualquer teria efeito
antes de o navegador barrar a leitura.

**Correção:** requisição com `Origin` fora da lista é recusada com **403** na
entrada. Requisição **sem** `Origin` (servidor-a-servidor, `curl`, navegação
direta) não é afetada — `Origin` é posto pelo navegador, e sua ausência não
caracteriza origem cruzada.

### D-3 · Inventário de `tenant_id` exigia a coluna na raiz — ASSERÇÃO

O teste exigia `tenant_id` em toda tabela, inclusive em `tenants`. Mas
`tenants.id` **é** o `tenant_id`: uma coluna apontando para si mesma não faria
sentido. A raiz passou a ter verificação própria (PK `uuid` + RLS ativa), em
vez de ser apenas ignorada.

### D-4 · Fixture de sessão expirada violava a CHECK — ASSERÇÃO

O teste envelhecia só `expires_at`, violando
`sessions_expires_after_creation (expires_at > created_at)`. A CHECK estava
certa; o teste é que criava uma sessão impossível. Agora a sessão é envelhecida
por inteiro, como uma sessão antiga de verdade.

---

## 11. Migration 0007 — checksum divergente

O banco de teste registra a versão `0007` com um checksum que **não** é o do
arquivo atual: uma migration diferente, de outra sessão, foi aplicada e depois
substituída no disco.

**O runner recusar é o comportamento correto** — é a prevenção do erro E6
(coluna e CHECK criadas por patch manual, fora do arquivo versionado)
funcionando.

**Resolução:** o **repositório é a fonte da verdade**; o banco de teste é
descartável. Nem afrouxar a guarda, nem editar `schema_migrations` à mão:

```bash
npm run db:reset-test
```

O script recusa qualquer banco cujo nome não termine em `_test`.

Nada foi aplicado em produção, e nenhuma migration precisou ser renumerada.
