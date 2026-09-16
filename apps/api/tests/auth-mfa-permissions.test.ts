import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  cleanup,
  createHarness,
  currentCode,
  grantMembership,
  grantPlatformRole,
  hasTestDatabase,
  loginAs,
  seedAccount,
  seedConfirmedTotp,
  seedTenantWithSlug,
  skipReason,
  unique,
  type Harness,
} from './helpers/apiHarness.js';

/**
 * Autenticacao, MFA (RN12), matriz de permissoes (DOC-01 secao 3) e revogacao.
 * Secao 8 do pedido, itens 5, 6, 7 e 8.
 */
describe.skipIf(!hasTestDatabase)(`API · autenticacao e autorizacao ${
  hasTestDatabase ? '' : skipReason
}`, () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
    await cleanup(harness.owner);
  });

  afterAll(async () => {
    await harness?.close();
  });

  // -------------------------------------------------------------------------
  // Autenticacao real
  // -------------------------------------------------------------------------
  describe('autenticacao', () => {
    it('login com senha correta abre sessao com cookie httpOnly', async () => {
      const account = await seedAccount(harness.owner);
      const res = await request(harness.app)
        .post('/api/auth/login')
        .send({ email: account.email, password: account.password });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('authenticated');

      const cookies = res.headers['set-cookie'] as unknown as string[];
      const sessionCookie = cookies.find((c) =>
        c.startsWith(`${harness.config.SESSION_COOKIE_NAME}=`),
      );
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie).toContain('HttpOnly');
      expect(sessionCookie).toContain('SameSite=Lax');
    });

    it('o token de sessao NAO aparece no corpo da resposta', async () => {
      const account = await seedAccount(harness.owner);
      const res = await request(harness.app)
        .post('/api/auth/login')
        .send({ email: account.email, password: account.password });
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/token/i);
    });

    it('senha errada e e-mail inexistente devolvem a MESMA resposta', async () => {
      const account = await seedAccount(harness.owner);

      const wrongPassword = await request(harness.app)
        .post('/api/auth/login')
        .send({ email: account.email, password: 'senha-errada' });
      const noSuchUser = await request(harness.app)
        .post('/api/auth/login')
        .send({ email: `${unique('ghost-')}@example.com`, password: 'qualquer' });

      expect(wrongPassword.status).toBe(401);
      expect(noSuchUser.status).toBe(401);
      expect(wrongPassword.body).toEqual(noSuchUser.body);
    });

    it('sem cookie, rota autenticada devolve 401', async () => {
      const res = await request(harness.app).get('/api/auth/session');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('cookie forjado nao autentica', async () => {
      const res = await request(harness.app)
        .get('/api/auth/session')
        .set('Cookie', `${harness.config.SESSION_COOKIE_NAME}=token-inventado`);
      expect(res.status).toBe(401);
    });

    it('tentativas repetidas bloqueiam a conta temporariamente', async () => {
      const account = await seedAccount(harness.owner);
      for (let i = 0; i < harness.config.LOGIN_MAX_ATTEMPTS; i += 1) {
        await request(harness.app)
          .post('/api/auth/login')
          .send({ email: account.email, password: 'errada' });
      }
      const res = await request(harness.app)
        .post('/api/auth/login')
        .send({ email: account.email, password: account.password });
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
    });
  });

  // -------------------------------------------------------------------------
  // Item 8 · revogacao
  // -------------------------------------------------------------------------
  describe('item 8 · revogacao impede reutilizacao do acesso', () => {
    it('logout invalida o cookie na requisicao seguinte', async () => {
      const account = await seedAccount(harness.owner);
      const { cookie } = await loginAs(harness, account);

      const before = await request(harness.app).get('/api/auth/session').set('Cookie', cookie);
      expect(before.status).toBe(200);

      const logout = await request(harness.app).post('/api/auth/logout').set('Cookie', cookie);
      expect(logout.status).toBe(204);

      // O MESMO cookie, reapresentado, nao vale mais.
      const after = await request(harness.app).get('/api/auth/session').set('Cookie', cookie);
      expect(after.status).toBe(401);
    });

    it('logout-all revoga todas as sessoes abertas', async () => {
      const account = await seedAccount(harness.owner);
      const first = await loginAs(harness, account);
      const second = await loginAs(harness, account);

      const res = await request(harness.app)
        .post('/api/auth/logout-all')
        .set('Cookie', second.cookie);
      expect(res.status).toBe(200);
      expect(res.body.revoked).toBeGreaterThanOrEqual(2);

      for (const cookie of [first.cookie, second.cookie]) {
        const check = await request(harness.app).get('/api/auth/session').set('Cookie', cookie);
        expect(check.status).toBe(401);
      }
    });

    it('sessao revogada no banco para de valer imediatamente', async () => {
      const account = await seedAccount(harness.owner);
      const { cookie } = await loginAs(harness, account);

      await harness.owner.query(
        "UPDATE sessions SET revoked_at = now(), revoked_reason = 'teste' WHERE user_id = $1",
        [account.userId],
      );

      const res = await request(harness.app).get('/api/auth/session').set('Cookie', cookie);
      expect(res.status).toBe(401);
    });

    it('sessao expirada nao vale', async () => {
      const account = await seedAccount(harness.owner);
      const { cookie } = await loginAs(harness, account);

      // `sessions_expires_after_creation` exige expires_at > created_at.
      // Envelhecer so o expires_at violaria a CHECK; a sessao precisa ser
      // envelhecida por inteiro, como uma sessao antiga de verdade.
      await harness.owner.query(
        `UPDATE sessions
            SET created_at = now() - interval '2 hours',
                expires_at = now() - interval '1 hour'
          WHERE user_id = $1`,
        [account.userId],
      );

      const res = await request(harness.app).get('/api/auth/session').set('Cookie', cookie);
      expect(res.status).toBe(401);
    });

    it('revogar o vinculo tira o acesso ao painel na requisicao seguinte', async () => {
      const slug = unique('rev-');
      const tenantId = await seedTenantWithSlug(harness.owner, slug);
      const account = await seedAccount(harness.owner);
      await grantMembership(harness.owner, { tenantId, userId: account.userId, role: 'MARKETING' });

      const { cookie } = await loginAs(harness, account);

      const before = await request(harness.app)
        .get('/api/tenant/context')
        .set('Cookie', cookie)
        .set('x-tenant-slug', slug);
      expect(before.status).toBe(200);

      await harness.owner.query(
        'UPDATE memberships SET revoked_at = now() WHERE tenant_id = $1 AND user_id = $2',
        [tenantId, account.userId],
      );

      const after = await request(harness.app)
        .get('/api/tenant/context')
        .set('Cookie', cookie)
        .set('x-tenant-slug', slug);
      expect(after.status).toBe(404);
      expect(after.body.error.code).toBe('TENANT_ACCESS_DENIED');
    });
  });

  // -------------------------------------------------------------------------
  // Item 6 · MFA obrigatorio (RN12)
  // -------------------------------------------------------------------------
  describe('item 6 · RN12 · MFA obrigatorio para dono, financeiro e Super Admin', () => {
    async function accountWithRole(role: string, platform = false) {
      const slug = unique('mfa-');
      const tenantId = await seedTenantWithSlug(harness.owner, slug);
      const account = await seedAccount(harness.owner);
      if (platform) {
        await grantPlatformRole(harness.owner, { userId: account.userId, role });
      } else {
        await grantMembership(harness.owner, { tenantId, userId: account.userId, role });
      }
      return { account, tenantId, slug };
    }

    it('DONO sem fator cadastrado recebe mfa_enrollment_required no login', async () => {
      const { account } = await accountWithRole('OWNER');
      const { status } = await loginAs(harness, account);
      expect(status).toBe('mfa_enrollment_required');
    });

    it('FINANCEIRO sem fator cadastrado recebe mfa_enrollment_required', async () => {
      const { account } = await accountWithRole('FINANCE');
      const { status } = await loginAs(harness, account);
      expect(status).toBe('mfa_enrollment_required');
    });

    it('SUPER ADMIN sem fator cadastrado recebe mfa_enrollment_required', async () => {
      const { account } = await accountWithRole('PLATFORM_OPERATIONS', true);
      const { status } = await loginAs(harness, account);
      expect(status).toBe('mfa_enrollment_required');
    });

    it('DONO sem MFA satisfeito NAO acessa o painel da comunidade', async () => {
      const { account, slug } = await accountWithRole('OWNER');
      const { cookie } = await loginAs(harness, account);

      const res = await request(harness.app)
        .get('/api/tenant/context')
        .set('Cookie', cookie)
        .set('x-tenant-slug', slug);

      expect(res.status).toBe(403);
      expect(['MFA_REQUIRED', 'MFA_ENROLLMENT_REQUIRED']).toContain(res.body.error.code);
    });

    it('FINANCEIRO sem MFA satisfeito NAO acessa o painel', async () => {
      const { account, slug } = await accountWithRole('FINANCE');
      const { cookie } = await loginAs(harness, account);
      const res = await request(harness.app)
        .get('/api/tenant/context')
        .set('Cookie', cookie)
        .set('x-tenant-slug', slug);
      expect(res.status).toBe(403);
    });

    it('SUPER ADMIN sem MFA satisfeito NAO lista comunidades', async () => {
      const { account } = await accountWithRole('PLATFORM_OPERATIONS', true);
      const { cookie } = await loginAs(harness, account);
      const res = await request(harness.app).get('/api/platform/tenants').set('Cookie', cookie);
      expect(res.status).toBe(403);
      expect(['MFA_REQUIRED', 'MFA_ENROLLMENT_REQUIRED']).toContain(res.body.error.code);
    });

    it('SUPER ADMIN sem MFA satisfeito NAO cria comunidade', async () => {
      const { account } = await accountWithRole('PLATFORM_OPERATIONS', true);
      const { cookie } = await loginAs(harness, account);
      const res = await request(harness.app)
        .post('/api/platform/tenants')
        .set('Cookie', cookie)
        .send({ slug: unique('novo-'), name: 'Nova Comunidade' });
      expect(res.status).toBe(403);
    });

    it('com fator confirmado, login pede verificacao e o codigo correto libera', async () => {
      const { account, slug } = await accountWithRole('OWNER');
      const secret = await seedConfirmedTotp(harness.owner, account.userId);

      const login = await loginAs(harness, account);
      expect(login.status).toBe('mfa_required');

      const blocked = await request(harness.app)
        .get('/api/tenant/context')
        .set('Cookie', login.cookie)
        .set('x-tenant-slug', slug);
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe('MFA_REQUIRED');

      const verify = await request(harness.app)
        .post('/api/auth/mfa/verify')
        .set('Cookie', login.cookie)
        .send({ code: await currentCode(secret) });
      expect(verify.status).toBe(200);

      const allowed = await request(harness.app)
        .get('/api/tenant/context')
        .set('Cookie', login.cookie)
        .set('x-tenant-slug', slug);
      expect(allowed.status).toBe(200);
      expect(allowed.body.roles).toContain('OWNER');
    });

    it('codigo TOTP errado nao satisfaz o segundo fator', async () => {
      const { account } = await accountWithRole('OWNER');
      await seedConfirmedTotp(harness.owner, account.userId);
      const login = await loginAs(harness, account);

      const res = await request(harness.app)
        .post('/api/auth/mfa/verify')
        .set('Cookie', login.cookie)
        .send({ code: '000000' });
      expect(res.status).toBe(401);
    });

    it('o mesmo codigo nao vale duas vezes (replay)', async () => {
      const { account } = await accountWithRole('OWNER');
      const secret = await seedConfirmedTotp(harness.owner, account.userId);
      const login = await loginAs(harness, account);
      const code = await currentCode(secret);

      const first = await request(harness.app)
        .post('/api/auth/mfa/verify')
        .set('Cookie', login.cookie)
        .send({ code });
      expect(first.status).toBe(200);

      const second = await loginAs(harness, account);
      const replay = await request(harness.app)
        .post('/api/auth/mfa/verify')
        .set('Cookie', second.cookie)
        .send({ code });
      expect(replay.status).toBe(401);
    });

    it('tentativas erradas de codigo bloqueiam o segundo fator', async () => {
      // Um codigo TOTP tem 10^6 combinacoes e quem chega aqui ja tem a senha.
      // Sem limite, o segundo fator seria so um atraso.
      const { account } = await accountWithRole('OWNER');
      await seedConfirmedTotp(harness.owner, account.userId);
      const login = await loginAs(harness, account);

      for (let i = 0; i < harness.config.LOGIN_MAX_ATTEMPTS; i += 1) {
        const res = await request(harness.app)
          .post('/api/auth/mfa/verify')
          .set('Cookie', login.cookie)
          .send({ code: '000000' });
        expect(res.status).toBe(401);
      }

      const blocked = await request(harness.app)
        .post('/api/auth/mfa/verify')
        .set('Cookie', login.cookie)
        .send({ code: '000000' });
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');
    });

    it('a contagem de tentativas do MFA sobrevive ao erro (nao volta no rollback)', async () => {
      const { account } = await accountWithRole('OWNER');
      await seedConfirmedTotp(harness.owner, account.userId);
      const login = await loginAs(harness, account);

      await request(harness.app)
        .post('/api/auth/mfa/verify')
        .set('Cookie', login.cookie)
        .send({ code: '000000' });

      const { rows } = await harness.owner.query<{ mfa_failed_attempts: number }>(
        'SELECT mfa_failed_attempts FROM user_credentials WHERE user_id = $1',
        [account.userId],
      );
      expect(rows[0]?.mfa_failed_attempts).toBe(1);
    });

    it('acertar o codigo zera o contador de tentativas', async () => {
      const { account } = await accountWithRole('OWNER');
      const secret = await seedConfirmedTotp(harness.owner, account.userId);
      const login = await loginAs(harness, account);

      await request(harness.app)
        .post('/api/auth/mfa/verify')
        .set('Cookie', login.cookie)
        .send({ code: '000000' });

      const ok = await request(harness.app)
        .post('/api/auth/mfa/verify')
        .set('Cookie', login.cookie)
        .send({ code: await currentCode(secret) });
      expect(ok.status).toBe(200);

      const { rows } = await harness.owner.query<{ mfa_failed_attempts: number }>(
        'SELECT mfa_failed_attempts FROM user_credentials WHERE user_id = $1',
        [account.userId],
      );
      expect(rows[0]?.mfa_failed_attempts).toBe(0);
    });

    it('MFA satisfeito numa sessao NAO satisfaz outra sessao', async () => {
      const { account, slug } = await accountWithRole('OWNER');
      const secret = await seedConfirmedTotp(harness.owner, account.userId);

      const sessionA = await loginAs(harness, account);
      await request(harness.app)
        .post('/api/auth/mfa/verify')
        .set('Cookie', sessionA.cookie)
        .send({ code: await currentCode(secret) });

      const sessionB = await loginAs(harness, account);
      const res = await request(harness.app)
        .get('/api/tenant/context')
        .set('Cookie', sessionB.cookie)
        .set('x-tenant-slug', slug);
      expect(res.status).toBe(403);
    });

    it('o cadastro do segundo fator fica acessivel a quem ainda nao tem fator', async () => {
      const { account } = await accountWithRole('OWNER');
      const { cookie } = await loginAs(harness, account);

      const start = await request(harness.app).post('/api/auth/mfa/enroll').set('Cookie', cookie);
      expect(start.status).toBe(200);
      expect(typeof start.body.secret).toBe('string');
      expect(start.body.otpauthUri).toContain('otpauth://totp/');

      const confirm = await request(harness.app)
        .post('/api/auth/mfa/enroll/confirm')
        .set('Cookie', cookie)
        .send({ code: await currentCode(start.body.secret) });
      expect(confirm.status).toBe(200);

      // Cadastrar e confirmar ja satisfaz o fator na sessao corrente.
      const session = await request(harness.app).get('/api/auth/session').set('Cookie', cookie);
      expect(session.body.mfaSatisfied).toBe(true);
      expect(session.body.mfaEnrolled).toBe(true);
    });

    it('marketing, suporte e operador entram sem MFA', async () => {
      for (const role of ['MARKETING', 'SUPPORT', 'OPERATOR']) {
        const slug = unique('nomfa-');
        const tenantId = await seedTenantWithSlug(harness.owner, slug);
        const account = await seedAccount(harness.owner);
        await grantMembership(harness.owner, { tenantId, userId: account.userId, role });

        const { cookie, status } = await loginAs(harness, account);
        expect(status, `${role} nao deveria exigir MFA`).toBe('authenticated');

        const res = await request(harness.app)
          .get('/api/tenant/context')
          .set('Cookie', cookie)
          .set('x-tenant-slug', slug);
        expect(res.status, `${role} deveria acessar o painel`).toBe(200);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Item 7 · matriz da secao 3 aplicada no backend
  // -------------------------------------------------------------------------
  describe('item 7 · suporte, marketing e operador respeitam a matriz', () => {
    it('as permissoes devolvidas seguem a matriz do DOC-01 secao 3', async () => {
      const esperado: Record<string, { tem: string[]; naoTem: string[] }> = {
        SUPPORT: {
          tem: ['payment:read:status', 'buyer:read:full', 'support:act'],
          naoTem: ['payment:read:full', 'payment:refund', 'draw:write', 'team:manage'],
        },
        MARKETING: {
          tem: ['draw:write', 'draw:media:write', 'branding:write'],
          naoTem: [
            'payment:read:full',
            'payment:read:status',
            'buyer:read:full',
            'draw:lifecycle:write',
          ],
        },
        OPERATOR: {
          tem: ['draw:write', 'draw:lifecycle:write', 'payment:read:status', 'support:act'],
          naoTem: ['payment:read:full', 'payment:refund', 'buyer:read:full', 'branding:write'],
        },
      };

      for (const [role, expectation] of Object.entries(esperado)) {
        const slug = unique('mtx-');
        const tenantId = await seedTenantWithSlug(harness.owner, slug);
        const account = await seedAccount(harness.owner);
        await grantMembership(harness.owner, { tenantId, userId: account.userId, role });

        const { cookie } = await loginAs(harness, account);
        const res = await request(harness.app)
          .get('/api/tenant/context')
          .set('Cookie', cookie)
          .set('x-tenant-slug', slug);

        expect(res.status).toBe(200);
        const permissions: string[] = res.body.permissions;
        for (const permission of expectation.tem) {
          expect(permissions, `${role} deveria ter ${permission}`).toContain(permission);
        }
        for (const permission of expectation.naoTem) {
          expect(permissions, `${role} NAO deveria ter ${permission}`).not.toContain(permission);
        }
      }
    });

    it('rota que exige team:manage e negada a quem nao e dono', async () => {
      const slug = unique('audit-');
      const tenantId = await seedTenantWithSlug(harness.owner, slug);

      for (const role of ['SUPPORT', 'MARKETING', 'OPERATOR']) {
        const account = await seedAccount(harness.owner);
        await grantMembership(harness.owner, { tenantId, userId: account.userId, role });
        const { cookie } = await loginAs(harness, account);

        const res = await request(harness.app)
          .get('/api/tenant/audit-events')
          .set('Cookie', cookie)
          .set('x-tenant-slug', slug);

        // A rota exige MFA (RN12) e team:manage. Nenhum dos tres papeis passa.
        expect([403]).toContain(res.status);
      }
    });

    it('esconder o botao nao basta: a rota nega no backend', async () => {
      // O operador nao tem team:manage; a chamada direta a API e recusada,
      // independentemente de o painel exibir ou nao o botao.
      const slug = unique('backend-');
      const tenantId = await seedTenantWithSlug(harness.owner, slug);
      const account = await seedAccount(harness.owner);
      await grantMembership(harness.owner, { tenantId, userId: account.userId, role: 'OPERATOR' });
      const { cookie } = await loginAs(harness, account);

      const res = await request(harness.app)
        .get('/api/tenant/audit-events')
        .set('Cookie', cookie)
        .set('x-tenant-slug', slug);
      expect(res.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // Item 5 · usuario sem vinculo
  // -------------------------------------------------------------------------
  describe('item 5 · usuario sem vinculo nao acessa o painel', () => {
    it('usuario autenticado sem vinculo recebe 404 (nao 403)', async () => {
      const slug = unique('semvinculo-');
      await seedTenantWithSlug(harness.owner, slug);
      const outsider = await seedAccount(harness.owner);
      const { cookie } = await loginAs(harness, outsider);

      const res = await request(harness.app)
        .get('/api/tenant/context')
        .set('Cookie', cookie)
        .set('x-tenant-slug', slug);

      // 404 de proposito: um 403 confirmaria que a comunidade existe.
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('TENANT_ACCESS_DENIED');
    });

    it('usuario da comunidade A recebe 404 ao pedir a comunidade B', async () => {
      const slugA = unique('a-');
      const slugB = unique('b-');
      const tenantA = await seedTenantWithSlug(harness.owner, slugA);
      await seedTenantWithSlug(harness.owner, slugB);

      const account = await seedAccount(harness.owner);
      await grantMembership(harness.owner, {
        tenantId: tenantA,
        userId: account.userId,
        role: 'SUPPORT',
      });
      const { cookie } = await loginAs(harness, account);

      const ownTenant = await request(harness.app)
        .get('/api/tenant/context')
        .set('Cookie', cookie)
        .set('x-tenant-slug', slugA);
      expect(ownTenant.status).toBe(200);

      const otherTenant = await request(harness.app)
        .get('/api/tenant/context')
        .set('Cookie', cookie)
        .set('x-tenant-slug', slugB);
      expect(otherTenant.status).toBe(404);
    });

    it('papel de comunidade NAO concede acesso de plataforma', async () => {
      const slug = unique('dono-');
      const tenantId = await seedTenantWithSlug(harness.owner, slug);
      const account = await seedAccount(harness.owner);
      await grantMembership(harness.owner, { tenantId, userId: account.userId, role: 'OWNER' });
      const secret = await seedConfirmedTotp(harness.owner, account.userId);

      const { cookie } = await loginAs(harness, account);
      await request(harness.app)
        .post('/api/auth/mfa/verify')
        .set('Cookie', cookie)
        .send({ code: await currentCode(secret) });

      // Dono da comunidade, com MFA satisfeito: ainda assim nao e Super Admin.
      const res = await request(harness.app).get('/api/platform/tenants').set('Cookie', cookie);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('revogar privilegio de plataforma tem efeito imediato', () => {
    it('Super Admin revogado perde acesso na requisicao seguinte', async () => {
      const account = await seedAccount(harness.owner);
      await grantPlatformRole(harness.owner, {
        userId: account.userId,
        role: 'PLATFORM_OPERATIONS',
      });
      const secret = await seedConfirmedTotp(harness.owner, account.userId);

      const { cookie } = await loginAs(harness, account);
      await request(harness.app)
        .post('/api/auth/mfa/verify')
        .set('Cookie', cookie)
        .send({ code: await currentCode(secret) });

      const before = await request(harness.app).get('/api/platform/tenants').set('Cookie', cookie);
      expect(before.status).toBe(200);

      await harness.owner.query(
        'UPDATE platform_admins SET revoked_at = now() WHERE user_id = $1',
        [account.userId],
      );

      const after = await request(harness.app).get('/api/platform/tenants').set('Cookie', cookie);
      expect(after.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // Resolucao de comunidade
  // -------------------------------------------------------------------------
  describe('resolucao de comunidade', () => {
    it('slug desconhecido devolve 404, nunca uma comunidade padrao', async () => {
      const res = await request(harness.app)
        .get('/api/public/tenant')
        .set('x-tenant-slug', 'comunidade-que-nao-existe');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('TENANT_NOT_RESOLVED');
    });

    it('host desconhecido devolve 404, nunca uma comunidade padrao', async () => {
      const res = await request(harness.app)
        .get('/api/public/tenant')
        .set('Host', 'dominio-desconhecido.example');
      expect(res.status).toBe(404);
    });

    it('host desconhecido NAO e salvo pelo cabecalho quando ele esta desligado', async () => {
      // Com TENANT_HEADER_ENABLED desligado (o padrao, e o de producao), o
      // cabecalho e ignorado: o host volta a ser a unica fonte da comunidade.
      const slug = unique('gated-');
      await seedTenantWithSlug(harness.owner, slug);

      const strict = await createHarness({ tenantHeaderEnabled: false });
      try {
        const res = await request(strict.app)
          .get('/api/public/tenant')
          .set('Host', 'host-desconhecido.example')
          .set('x-tenant-slug', slug);

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('TENANT_NOT_RESOLVED');
      } finally {
        await strict.close();
      }
    });

    it('a vitrine publica devolve a marca sem exigir sessao', async () => {
      const slug = unique('vitrine-');
      await seedTenantWithSlug(harness.owner, slug, 'Comunidade Vitrine');

      const res = await request(harness.app).get('/api/public/tenant').set('x-tenant-slug', slug);
      expect(res.status).toBe(200);
      expect(res.body.slug).toBe(slug);
      expect(res.body.name).toBe('Comunidade Vitrine');
    });

    it('a vitrine publica nao expoe dado de negocio nem pessoal', async () => {
      const slug = unique('vitrine2-');
      await seedTenantWithSlug(harness.owner, slug);
      const res = await request(harness.app).get('/api/public/tenant').set('x-tenant-slug', slug);

      const keys = Object.keys(res.body);
      for (const proibido of ['memberships', 'users', 'roles', 'permissions', 'auditEvents']) {
        expect(keys).not.toContain(proibido);
      }
    });

    it('subdominio {slug}.dominio-base resolve a comunidade', async () => {
      const slug = unique('sub-');
      await seedTenantWithSlug(harness.owner, slug);
      const res = await request(harness.app)
        .get('/api/public/tenant')
        .set('Host', `${slug}.plataforma.local`);
      expect(res.status).toBe(200);
      expect(res.body.slug).toBe(slug);
    });
  });

  // -------------------------------------------------------------------------
  // Controle de origem
  // -------------------------------------------------------------------------
  describe('controle de origem', () => {
    it('origem declarada em CORS_ORIGINS e aceita', async () => {
      const origin = harness.config.corsOrigins[0];
      expect(origin, 'a bancada precisa de ao menos uma origem declarada').toBeTruthy();

      const res = await request(harness.app).get('/api/health').set('Origin', origin!);
      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('origem DESCONHECIDA e recusada com 403, nao apenas privada dos cabecalhos', async () => {
      // Omitir cabecalhos so impede o navegador de LER a resposta; a
      // requisicao ja teria sido executada.
      const res = await request(harness.app)
        .get('/api/health')
        .set('Origin', 'https://site-malicioso.example');

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('escrita vinda de origem desconhecida nao chega a executar', async () => {
      const account = await seedAccount(harness.owner);
      const res = await request(harness.app)
        .post('/api/auth/login')
        .set('Origin', 'https://site-malicioso.example')
        .send({ email: account.email, password: account.password });

      expect(res.status).toBe(403);
      // Nenhuma sessao foi aberta.
      const sessions = await harness.owner.query('SELECT 1 FROM sessions WHERE user_id = $1', [
        account.userId,
      ]);
      expect(sessions.rows).toHaveLength(0);
    });

    it('requisicao SEM Origin nao e afetada', async () => {
      // `Origin` e posto pelo navegador; sua ausencia nao e origem cruzada.
      const res = await request(harness.app).get('/api/health');
      expect(res.status).toBe(200);
    });

    it('white-label: subdominio de comunidade existente e origem valida', async () => {
      // Uma lista estatica quebraria o dominio proprio: cada comunidade chama
      // a API de um lugar diferente.
      const slug = unique('origem-');
      await seedTenantWithSlug(harness.owner, slug);

      const res = await request(harness.app)
        .get('/api/health')
        .set('Origin', `https://${slug}.plataforma.local`);

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe(`https://${slug}.plataforma.local`);
    });

    it('subdominio de comunidade INEXISTENTE e recusado', async () => {
      const res = await request(harness.app)
        .get('/api/health')
        .set('Origin', 'https://comunidade-que-nao-existe.plataforma.local');
      expect(res.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // Diagnostico
  // -------------------------------------------------------------------------
  it('a rota de saude responde sem sessao', async () => {
    const res = await request(harness.app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('up');
  });
});
