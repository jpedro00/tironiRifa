# Runbook — infraestrutura de staging

Como levantar o ambiente de staging do zero, na ordem em que precisa acontecer.

**Staging não é produção.** É um ambiente descartável, exposto na internet, com
TLS e sem dado real de pessoa nenhuma. Nada aqui descreve produção.

---

## Princípio que organiza tudo abaixo

Três credenciais de banco, três usos que nunca se misturam:

| Credencial | Quem usa | Quando |
|---|---|---|
| `DATABASE_ADMIN_URL` | um operador, da máquina dele | bootstrap, migrations, `queue:install` |
| `DATABASE_URL` | API (`app_user`) | sempre |
| `WORKER_DATABASE_URL` | worker (`app_worker`) | sempre |

O administrativo **nunca** entra num serviço do Render. DDL é ato deliberado,
não efeito colateral de um deploy — inclusive de um rollback.

---

## 1. Banco — Neon

1. Criar um projeto Neon: **`campaigns-staging`**. Região próxima à do Render
   (Oregon / `us-west-2`) — cada milissegundo de latência aqui aparece em toda
   requisição, porque a RLS faz o banco participar de tudo.
2. Anotar a connection string do **dono** → `DATABASE_ADMIN_URL`.
3. Neon exige TLS. Todas as URLs precisam de `?sslmode=require`, e os serviços
   sobem com `DATABASE_SSL=true`.

### Bootstrap, migrations e fila

Da máquina do operador, com `DATABASE_ADMIN_URL` em mãos:

```bash
export ADMIN_DATABASE_URL="<dono>"          # cria banco e papéis
export DATABASE_NAME=campaigns_staging
export APP_DB_PASSWORD="<gerada>"
export WORKER_DB_PASSWORD="<gerada>"

npm run db:bootstrap        # cria app_user e app_worker, restritos

export MIGRATION_DATABASE_URL="<dono>"
npm run db:migrate          # 0001 … 0008

export QUEUE_ADMIN_DATABASE_URL="<dono>"
npm run queue:install -w @campaigns/worker   # schema pgboss, posse do app_worker
```

> Se o Neon não permitir `CREATE DATABASE` no plano usado, aponte
> `ADMIN_DATABASE_URL` direto para o banco já existente e defina
> `DATABASE_NAME` com o nome dele — o bootstrap detecta que já existe e segue
> criando apenas os papéis.

### Conferir antes de prosseguir

```sql
SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
  FROM pg_roles WHERE rolname IN ('app_user','app_worker');
-- os quatro booleanos precisam ser false nos dois papéis

SELECT has_database_privilege('app_worker', current_database(), 'CREATE');
-- precisa ser false: instalar a fila é etapa administrativa

SELECT nspname, pg_get_userbyid(nspowner) FROM pg_namespace
 WHERE nspname IN ('public','app','pgboss');
-- pgboss precisa pertencer a app_worker
```

### Provar a RLS no banco gerenciado

Migration aplicada não é prova de isolamento. Rodar a suíte contra o Neon:

```bash
export TEST_MIGRATION_DATABASE_URL="<dono>"
export TEST_APP_DATABASE_URL="<app_user>"
export TEST_WORKER_DATABASE_URL="<app_worker>"

npx vitest run packages/db/tests apps/api/tests apps/worker/tests
```

As suítes de isolamento conectam com o papel **real** da aplicação. Testar RLS
como dono não prova nada: o dono ignora as policies.

---

## 2. API — Render

O repositório traz [`render.yaml`](../../render.yaml), um Blueprint. Criar o
serviço a partir dele (Render → New → Blueprint) em vez de preencher o painel à
mão: a configuração passa a ser revisável e recriável.

Variáveis marcadas `sync: false` são pedidas na criação e guardadas cifradas:

```text
DATABASE_URL           app_user (nunca o dono)
MFA_ENCRYPTION_KEY     node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
CORS_ORIGINS           preencher depois do passo 4
```

`CORS_ORIGINS` só existe depois que o Vercel devolver as URLs. Deixar em branco
faz a API **recusar subir** em staging, de propósito — uma API sem allowlist
não conversa com painel nenhum, e falhar na subida é melhor do que descobrir
isso pelo navegador.

Healthcheck: `/api/health`. Responde 200 mesmo com o banco fora, informando
`database: "down"` — quem observa precisa distinguir "API fora" de "API no ar,
banco fora".

---

## 3. Worker — Render

Mesmo Blueprint, serviço `campaigns-worker-staging`, tipo `worker`.

```text
WORKER_DATABASE_URL    app_worker
QUEUE_DATABASE_URL     app_worker (mesmo papel; o schema pgboss é dele)
```

A fila **precisa** ter sido instalada no passo 1. Se não tiver, o worker recusa
subir com a instrução do que fazer, em vez de tropeçar num `permission denied
for database` cru.

---

## 4. Frontends — Vercel

**Três projetos separados**, o mesmo repositório, Root Directory diferente. Não
unificar: são três aplicações, com públicos e superfícies de ataque diferentes.

| Projeto | Root Directory |
|---|---|
| `campaigns-storefront-staging` | `apps/storefront` |
| `campaigns-organizer-staging` | `apps/organizer` |
| `campaigns-admin-staging` | `apps/admin` |

Build e output vêm do `vercel.json` de cada app; não há o que preencher no
painel além do Root Directory.

Variável, em cada projeto — **a única**, e pública:

```text
VITE_API_BASE_URL = https://campaigns-api-staging.onrender.com
```

O Vite **embute** tudo que começa com `VITE_` no pacote entregue ao navegador.
Nenhum segredo, em hipótese alguma.

---

## 5. Fechar o círculo do CORS

Com as três URLs do Vercel em mãos, preencher na API:

```text
CORS_ORIGINS = https://campaigns-storefront-staging.vercel.app,https://campaigns-organizer-staging.vercel.app,https://campaigns-admin-staging.vercel.app
```

Sem curinga. `Access-Control-Allow-Origin: *` é **incompatível** com
`credentials: include` — o navegador recusa —, e a API autentica por cookie.

Redeploy da API.

### Cookies entre sites, e por que `SameSite=None`

Vercel e Render são **sites diferentes**. Com `SameSite=Lax` o navegador não
envia o cookie em `fetch` cross-site: o login responderia 200, o `Set-Cookie`
chegaria, e toda requisição seguinte voltaria 401 — um sistema que parece
funcionar e não autentica.

`SESSION_COOKIE_SAMESITE=none` + `SESSION_COOKIE_SECURE=true` descreve
honestamente essa topologia. O que substitui a proteção que `Lax` dava é o
`originGuard`: ele recusa com 403, **antes do handler**, qualquer requisição com
`Origin` fora da allowlist — e `Origin` é posto pelo navegador e não pode ser
forjado por página. A defesa não sumiu; mudou de mecanismo.

A configuração **recusa** `none` sem `Secure`: o navegador descartaria esse
cookie de qualquer forma.

---

## 6. Primeiro Super Admin

Não há rota que crie o primeiro — seria escalada de privilégio aberta na
internet. Pelo banco, com a credencial administrativa:

```sql
INSERT INTO users (email, display_name)
VALUES ('voce@example.com', 'Seu Nome') RETURNING id;

INSERT INTO platform_admins (user_id, role)
VALUES ('<id acima>', 'PLATFORM_OPERATIONS');
```

A credencial precisa existir em `user_credentials` com hash `scrypt$…` gerado
por `hashPassword()`:

```bash
node -e "
  const { hashPassword } = await import('./apps/api/dist/lib/password.js');
  console.log(await hashPassword(process.argv[1]));
" '<senha>'
```

No primeiro login o console exige o cadastro do segundo fator: **RN12 não tem
escape**.

---

## 7. Verificação de aceite

### Banco
- [ ] `app_user` e `app_worker` com `rolsuper=false`, `rolbypassrls=false`
- [ ] `app_worker` **não** consegue criar schema
- [ ] `pgboss` pertence a `app_worker`
- [ ] suíte de isolamento verde contra o Neon

### API
- [ ] `/api/health` → `{"status":"ok","database":"up"}`
- [ ] origem da allowlist → 200 com `Access-Control-Allow-Origin`
- [ ] origem desconhecida → **403**
- [ ] preflight `OPTIONS` da allowlist → 204
- [ ] login → `Set-Cookie` com `HttpOnly; Secure; SameSite=None`
- [ ] variável obrigatória ausente → a API **não sobe**

### Worker
- [ ] log de subida com o schema da fila
- [ ] evento na outbox → `published_at` → `event_consumptions` → efeito
- [ ] reentrega do mesmo evento → **um** efeito
- [ ] evento que falha além do limite → `dead_lettered_at`, sem voltar ao ciclo
- [ ] redeploy → `SIGTERM` → relay para, fila para, pool fecha

### Frontends
- [ ] os três abrem sem erro no console
- [ ] login e sessão preservada após refresh
- [ ] MFA rotaciona o token; o antigo devolve 401
- [ ] API fora → estado `unavailable`, **não** tela de login
- [ ] logout revoga a sessão

### Auditoria
- [ ] `auth.login.succeeded`, `auth.login.failed`, `auth.logout`,
      `auth.mfa.*`, `auth.account_locked` presentes
- [ ] nenhum segredo em `before`/`after`
- [ ] eventos de identidade **não** aparecem em `/api/tenant/audit-events`

---

## O que NÃO entra nesta rodada

Mercado Pago, Vindi, WhatsApp, e-mail real, Cloudflare R2, domínio próprio,
DNS final, GA4, Meta Pixel, sorteios, cativos, pagamentos. Nada de Fase 2.
