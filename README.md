# Plataforma de Campanhas & Comunidades

SaaS multi-tenant e white-label de sorteios e campanhas. Cada comunidade opera
a própria marca, domínio, equipe e sorteios, com isolamento de dados.

**Estado atual: Fase 1 — Fundação.**
Não há sorteio, reserva, pagamento, imagem, apuração nem cliente cativo. Esses
módulos pertencem às fases seguintes. O que existe aqui é a base que eles vão
usar: isolamento por comunidade, identidade, permissões, auditoria e outbox.

---

## Índice

- [Estrutura](#estrutura)
- [O que a Fase 1 entrega](#o-que-a-fase-1-entrega)
- [Setup local](#setup-local)
- [Rodar](#rodar)
- [Testes](#testes)
- [Rotas](#rotas)
- [Documentos](#documentos)

---

## Estrutura

```
apps/
  api/          API HTTP (Express). Conecta com o papel restrito app_user.
  worker/       Relay da outbox + consumidores (pg-boss).
  storefront/   Vitrine do participante (React + Vite).
  organizer/    Painel do organizador (React + Vite).
  admin/        Console Super Admin (React + Vite).
packages/
  shared/       Constantes protegidas, estados, permissões, contratos de rota.
  db/           Migrations versionadas, pool e contexto transacional de tenant.
docs/
  decisions/    Decisões e suposições da fase.
  parity/       Divergências entre o DOC-01 e o código da NewStore.
```

Os módulos **M01–M12** vivem em `apps/api/src/modules/`. Esta fase implementa
apenas **M01** (identidade, comunidade e permissões) e **M12** (auditoria e
observabilidade). As pastas dos demais módulos **não foram criadas**: pasta
vazia sugere trabalho que não existe.

---

## O que a Fase 1 entrega

| Área | Estado |
|---|---|
| Migrations versionadas com RLS | ✅ |
| Isolamento por comunidade, com o papel real da aplicação | ✅ |
| Identidade global + vínculos por comunidade | ✅ |
| Autenticação (senha + sessão + logout + revogação) | ✅ |
| MFA obrigatório para dono, financeiro e Super Admin (RN12) | ✅ |
| Matriz de permissões do DOC-01 §3, aplicada no backend | ✅ |
| Resolução de comunidade por domínio ou slug | ✅ |
| Auditoria somente-inserção (RN11) | ✅ |
| Outbox transacional + relay + consumidor idempotente (RN21) | ✅ |
| Três frontends React com sessão, contexto e controle de acesso | ✅ |
| Constantes protegidas com teste que falha se mudarem | ✅ |
| CI com lint, typecheck, testes e build | ✅ |

**Fora do escopo desta fase** (e não simulado em lugar nenhum): pagamentos,
reservas, imagens, apuração, automações comerciais e clientes cativos.

---

## Setup local

### Pré-requisitos

- Node.js **22+**
- PostgreSQL **17** (local, Docker ou Neon)

### 1. Dependências

```bash
npm install
```

### 2. Variáveis de ambiente

```bash
cp .env.example .env
```

Gere a chave de cifragem dos segredos TOTP e cole em `MFA_ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Preencha também `ADMIN_DATABASE_URL`, `APP_DB_PASSWORD` e `WORKER_DB_PASSWORD`.

> **Três papéis, de propósito.** `ADMIN_*` é superusuário e roda só o
> bootstrap. `MIGRATION_*` é dono do schema e roda as migrations. `DATABASE_URL`
> é o papel restrito `app_user`, com que a API roda — e é por isso que a RLS
> vale de verdade: `app_user` não é dono das tabelas e não tem `BYPASSRLS`.

### 3. Compilar os pacotes compartilhados

`api`, `worker` e os frontends importam tipos de `@campaigns/shared` e
`@campaigns/db`. Sem este passo, o typecheck não encontra as declarações.

```bash
npm run build -w @campaigns/shared
npm run build -w @campaigns/db
```

### 4. Banco: bootstrap e migrations

```bash
npm run db:bootstrap   # cria o banco e os papéis restritos app_user e app_worker
npm run db:migrate     # aplica as migrations
```

O bootstrap fica fora das migrations de propósito: criar papel exige privilégio
administrativo e envolve **senha** — e senha não entra em arquivo versionado.

As migrations recusam rodar se `app_user` e `app_worker` não existirem. Sem
isso, a aplicação se conectaria como dono do schema e a RLS seria silenciosamente
inofensiva.

### 5. Banco de teste

Os testes de isolamento precisam de um banco **separado** — a suíte apaga dados.

```bash
# Bash
DATABASE_NAME=campaigns_test npm run db:bootstrap
MIGRATION_DATABASE_URL="postgres://postgres:SENHA@localhost:5432/campaigns_test" npm run db:migrate
```

```powershell
# PowerShell
$env:DATABASE_NAME = 'campaigns_test'; npm run db:bootstrap
$env:MIGRATION_DATABASE_URL = 'postgres://postgres:SENHA@localhost:5432/campaigns_test'; npm run db:migrate
```

---

## Rodar

Quatro terminais:

```bash
npm run dev:api          # http://localhost:3000
npm run dev:worker
npm run dev:storefront   # http://localhost:5173
npm run dev:organizer    # http://localhost:5174
npm run dev:admin        # http://localhost:5175
```

### Escolher a comunidade em desenvolvimento

Em produção a comunidade sai do **domínio**. Em `localhost` não há subdomínio
por comunidade, então a vitrine e o painel aceitam `?tenant=<slug>` uma vez e
memorizam a escolha:

```
http://localhost:5173/?tenant=minha-comunidade
```

O navegador envia apenas o **slug**. O `tenant_id` sai do banco, e o vínculo é
conferido lá — um `tenant_id` enviado pelo cliente nunca é aceito.

**Domínio desconhecido devolve 404.** Não existe comunidade padrão de fallback:
cair numa comunidade qualquer seria servir a marca e os dados de outro cliente.

### Primeiro Super Admin

Não há rota que crie o primeiro Super Admin — ela seria um caminho de escalada
de privilégio aberto na internet. A primeira concessão é feita no banco, pelo
dono do schema:

```sql
-- 1. a pessoa (senha definida pelo fluxo de convite, ainda da Fase 5)
INSERT INTO users (email, display_name)
VALUES ('voce@example.com', 'Seu Nome')
RETURNING id;

-- 2. o privilégio, explícito
INSERT INTO platform_admins (user_id, role)
VALUES ('<id devolvido acima>', 'PLATFORM_OPERATIONS');
```

A credencial precisa existir em `user_credentials` com um hash `scrypt$…`
gerado por `hashPassword()` (`apps/api/src/lib/password.ts`). No primeiro login
o console exigirá o cadastro do segundo fator: **RN12 não tem escape**.

---

## Testes

```bash
npm run lint        # ESLint
npm run typecheck   # TypeScript estrito em todos os pacotes
npm test            # Vitest
npm run build       # build de todos os pacotes e frontends
```

### Testes que exigem PostgreSQL

Os testes de RLS, auditoria, outbox e migrations rodam contra **PostgreSQL
real**, com o papel real da aplicação. Sem as variáveis abaixo eles são
**pulados** — nunca substituídos por mock, porque um mock de RLS provaria
apenas que o mock funciona.

```bash
export TEST_MIGRATION_DATABASE_URL="postgres://postgres:SENHA@localhost:5432/campaigns_test"
export TEST_APP_DATABASE_URL="postgres://app_user:SENHA@localhost:5432/campaigns_test"
export TEST_WORKER_DATABASE_URL="postgres://app_worker:SENHA@localhost:5432/campaigns_test"
npm test
```

```powershell
$env:TEST_MIGRATION_DATABASE_URL = 'postgres://postgres:SENHA@localhost:5432/campaigns_test'
$env:TEST_APP_DATABASE_URL       = 'postgres://app_user:SENHA@localhost:5432/campaigns_test'
$env:TEST_WORKER_DATABASE_URL    = 'postgres://app_worker:SENHA@localhost:5432/campaigns_test'
npm test
```

O CI (`.github/workflows/ci.yml`) sobe um PostgreSQL 17 real e **falha se
qualquer teste for pulado** — um CI verde sem os testes de isolamento seria uma
falsa aprovação.

### Cobertura por arquivo

| Arquivo | O que prova | Precisa de banco |
|---|---|---|
| `packages/shared/tests/protected-constants.test.ts` | RN05, RN13, RN16, RN18 e os estados literais do DOC-01 | não |
| `packages/shared/tests/permission-matrix.test.ts` | Matriz do DOC-01 §3, separação status × financeiro × dado pessoal, RN12 | não |
| `apps/api/tests/auth-primitives.test.ts` | scrypt, TOTP, replay, AES-GCM, token de sessão | não |
| `apps/api/tests/route-contract.test.ts` | E4: contrato ↔ rotas registradas, nos dois sentidos | não |
| `packages/db/tests/migrations-on-empty-database.test.ts` | Migrations do zero; `tenant_id` + RLS em toda tabela de negócio | **sim** |
| `packages/db/tests/enum-parity.test.ts` | E3: `pg_enum` ↔ enums do código | **sim** |
| `packages/db/tests/tenant-isolation.test.ts` | RN01: A não lê/altera/relaciona dados de B; contexto não vaza | **sim** |
| `packages/db/tests/audit-immutability.test.ts` | RN11: UPDATE/DELETE/TRUNCATE recusados; sem segredos na trilha | **sim** |
| `packages/db/tests/outbox-transactional.test.ts` | RN21: rollback desfaz o evento junto | **sim** |
| `apps/api/tests/auth-mfa-permissions.test.ts` | MFA obrigatório, matriz no backend, revogação | **sim** |
| `apps/worker/tests/outbox-relay-and-consumer.test.ts` | Relay, recuperação, reprocessamento sem duplicar | **sim** |

---

## Rotas

Todas as rotas nascem de `packages/shared/src/contracts/routes.ts`. Os
frontends chamam por **nome de contrato**, nunca por string de caminho — uma
rota inexistente quebra o typecheck, não a produção (erro E4).

| Método | Caminho | Exige |
|---|---|---|
| `GET` | `/api/health` | — |
| `GET` | `/api/public/tenant` | comunidade resolvida |
| `POST` | `/api/auth/login` | — |
| `POST` | `/api/auth/logout` | sessão |
| `POST` | `/api/auth/logout-all` | sessão |
| `GET` | `/api/auth/session` | sessão |
| `POST` | `/api/auth/mfa/enroll` | sessão |
| `POST` | `/api/auth/mfa/enroll/confirm` | sessão |
| `POST` | `/api/auth/mfa/verify` | sessão |
| `GET` | `/api/tenant/context` | sessão + vínculo + `tenant:read` |
| `GET` | `/api/tenant/audit-events` | sessão + MFA + `team:manage` |
| `GET` | `/api/platform/tenants` | sessão + MFA + `platform:tenant:read` |
| `POST` | `/api/platform/tenants` | sessão + MFA + `platform:tenant:create` |

---

## Documentos

- [`docs/decisions/fase-1-decisoes.md`](docs/decisions/fase-1-decisoes.md) —
  decisões, suposições e pendências abertas.
- [`docs/parity/newstore-divergences.md`](docs/parity/newstore-divergences.md) —
  divergências entre o DOC-01 e o código da NewStore, incluindo o prazo de
  reserva.

---

## Próxima fase

**Fase 2 — núcleo NewStore:** grade dinâmica, reservas de 30 minutos, pedidos e
PIX via Mercado Pago, com testes de paridade primeiro.

Antes de começar, três coisas precisam de decisão do produto:

1. **Prazo de reserva** — o DOC-01 fixa 30; o código da NewStore usa 5 ou 30
   conforme a rota, via variável de ambiente. Ver `docs/parity/`.
2. **Trava de reserva** — o DOC-01 §9 desenha Redis; o painel do Astra escolhe
   só PostgreSQL. A divergência está registrada, não resolvida.
3. **Matriz do Super Admin (S8)** — a distribuição atual por sub-perfil é
   suposição conservadora e precisa de validação.
