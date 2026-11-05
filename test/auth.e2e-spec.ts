import type { NestExpressApplication } from '@nestjs/platform-express';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { FakeCore } from './support/fake-core.js';
import {
  RT_1,
  RT_2,
  SESSION_ID,
  TEST_ORIGIN,
  USER_ID,
  createTestApp,
  sessionHandler,
  setCookie,
} from './support/app.js';

const COOKIE = '__Host-cdp_rt';

/** Access token (Bearer) + refresh token (cookie HttpOnly, xoay vòng) qua BFF thật và Core_API giả. */
describe('Auth (e2e)', () => {
  const core = new FakeCore();
  let app: NestExpressApplication;
  let revoked = false;

  beforeAll(async () => {
    await core.start();
    app = await createTestApp(core);
  });
  afterAll(async () => {
    await app.close();
    await core.stop();
  });
  beforeEach(() => {
    core.requests.length = 0;
    revoked = false;
    core.handler = sessionHandler({ revoked: () => revoked });
  });

  const http = () => request(app.getHttpServer());
  const login = (password = 'correct-horse-battery') =>
    http()
      .post('/api/admin/auth/login')
      .send({ email: 'admin@example.com', password });
  const refresh = (token?: string, origin: string | null = TEST_ORIGIN) => {
    const r = http().post('/api/admin/auth/refresh');
    if (origin) r.set('Origin', origin);
    if (token) r.set('Cookie', `${COOKIE}=${token}`);
    return r;
  };

  // ---------- đăng nhập ----------

  it('login: access token ES256 10 phút trong body, refresh token CHỈ trong cookie HttpOnly Strict', async () => {
    const res = await login();

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.tokenType).toBe('Bearer');
    expect(res.body.expiresIn).toBe(600);
    expect(res.body.user).toEqual(
      expect.objectContaining({
        userId: USER_ID,
        permissions: ['Catalog.Edit'],
      }),
    );
    expect(JSON.stringify(res.body)).not.toContain(RT_1);

    const header = decodeProtectedHeader(res.body.accessToken);
    expect(header.alg).toBe('ES256');
    expect(header.kid).toBeTruthy();
    const claims = decodeJwt(res.body.accessToken);
    expect(claims).toEqual(
      expect.objectContaining({
        iss: 'bff',
        aud: 'admin-portal',
        sub: USER_ID,
        sid: SESSION_ID,
        perms: ['Catalog.Edit'],
      }),
    );
    expect(claims.exp! - claims.iat!).toBe(600);

    const cookie = setCookie(res, COOKIE)!;
    expect(cookie).toContain(`${COOKIE}=${RT_1}`);
    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookie).toMatch(/;\s*Secure/i);
    expect(cookie).toMatch(/;\s*SameSite=Strict/i);
    expect(cookie).toMatch(/;\s*Path=\/(;|$)/i);
    expect(cookie).toMatch(/;\s*Expires=/i);
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it('login gọi Core_API với Edge key + Service JWT + Correlation_Id, không sub/sid (chưa có phiên)', async () => {
    await login().set('X-Correlation-Id', 'e2e-corr-1');
    const h = core.requests[0].headers;
    expect(h['x-edge-key']).toBeDefined();
    expect(h['x-correlation-id']).toBe('e2e-corr-1');
    expect(decodeJwt(String(h['authorization']).slice(7)).sub).toBeUndefined();
  });

  it('login sai: 401 ProblemDetails chung, không set cookie', async () => {
    const res = await login('wrong-password');
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.code).toBe('InvalidCredentials');
    expect(setCookie(res, COOKIE)).toBeUndefined();
  });

  it('login thiếu trường: 400 kèm errors theo trường, không gọi Core_API', async () => {
    const res = await http()
      .post('/api/admin/auth/login')
      .send({ email: 'a@b.c' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.errors)).toEqual(['password']);
    expect(core.requests).toHaveLength(0);
  });

  // ---------- refresh ----------

  it('refresh: xoay vòng (cookie mới), access token mới, refresh token gửi Core_API trong BODY', async () => {
    const res = await refresh(RT_1);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(decodeJwt(res.body.accessToken).sid).toBe(SESSION_ID);
    expect(setCookie(res, COOKIE)).toContain(`${COOKIE}=${RT_2}`);
    expect(JSON.parse(core.requests[0].body)).toEqual({ refreshToken: RT_1 });
    expect(core.requests[0].url).toBe('/api/app/auth/sessions/refresh');
  });

  it('refresh trong grace (Core_API không phát token mới): có access token, KHÔNG đổi cookie', async () => {
    const res = await refresh(RT_2);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(setCookie(res, COOKIE)).toBeUndefined();
  });

  it('refresh bị Core_API từ chối (hết hạn / thu hồi / dùng lại): 401 và xóa cookie', async () => {
    const res = await refresh('Z'.repeat(43));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('Unauthenticated');
    expect(setCookie(res, COOKIE)).toMatch(/Expires=Thu, 01 Jan 1970/i);
  });

  it('refresh không có cookie (hoặc cookie rác): 401, không gọi Core_API', async () => {
    expect((await refresh()).status).toBe(401);
    expect((await refresh('rac')).status).toBe(401);
    expect(core.requests).toHaveLength(0);
  });

  it.each([
    ['thiếu Origin', null],
    ['Origin lạ', 'https://evil.example'],
    ['Origin gần giống', 'http://localhost:5173.evil.example'],
  ])(
    'refresh với %s: 403 OriginNotAllowed, không gọi Core_API',
    async (_name, origin) => {
      const res = await refresh(RT_1, origin);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('OriginNotAllowed');
      expect(core.requests).toHaveLength(0);
    },
  );

  // ---------- me ----------

  it('me: Bearer hợp lệ → hỏi Core_API bằng Service JWT có sub/sid, trả user mới nhất', async () => {
    const { accessToken } = (await login()).body;
    core.requests.length = 0;

    const res = await http()
      .get('/api/admin/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('admin@example.com');
    const service = decodeJwt(
      String(core.requests[0].headers['authorization']).slice(7),
    );
    expect(service.sub).toBe(USER_ID);
    expect(service.sid).toBe(SESSION_ID);
    expect(service.aud).toBe('core-api');
  });

  it('me: phiên đã bị thu hồi ở Core_API → 401 ngay dù access token còn hạn', async () => {
    const { accessToken } = (await login()).body;
    revoked = true;

    const res = await http()
      .get('/api/admin/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('Unauthenticated');
  });

  it('me: không token / token rác / sai chữ ký → 401 Unauthenticated', async () => {
    // Làm hỏng một ký tự GIỮA chữ ký: ký tự cuối base64url có bit đệm, đổi nó có thể vẫn ra đúng chữ ký (test chập chờn).
    const token: string = (await login()).body.accessToken;
    const signatureStart = token.lastIndexOf('.') + 1;
    const i = signatureStart + 10;
    const forged =
      token.slice(0, i) + (token[i] === 'A' ? 'B' : 'A') + token.slice(i + 1);
    for (const auth of [
      undefined,
      'Bearer rac',
      'Basic abc',
      `Bearer ${forged}`,
    ]) {
      const r = http().get('/api/admin/auth/me');
      const res = await (auth ? r.set('Authorization', auth) : r);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('Unauthenticated');
    }
  });

  it('me: Service JWT của Core_API (aud=core-api) không dùng làm access token được', async () => {
    await login();
    const serviceToken = String(
      core.requests[0].headers['authorization'],
    ).slice(7);
    const res = await http()
      .get('/api/admin/auth/me')
      .set('Authorization', `Bearer ${serviceToken}`);
    expect(res.status).toBe(401);
  });

  it('me: access token quá 10 phút → 401 TokenExpired (client sẽ refresh)', async () => {
    const { accessToken } = (await login()).body;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    try {
      const res = await http()
        .get('/api/admin/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('TokenExpired');
    } finally {
      vi.useRealTimers();
    }
  });

  // ---------- logout ----------

  it('logout: thu hồi ở Core_API (token trong body) và xóa cookie', async () => {
    const res = await http()
      .post('/api/admin/auth/logout')
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', `${COOKIE}=${RT_1}`);

    expect(res.status).toBe(204);
    expect(setCookie(res, COOKIE)).toMatch(/Expires=Thu, 01 Jan 1970/i);
    const revoke = core.requests.find(
      (r) => r.url === '/api/app/auth/sessions/revoke',
    )!;
    expect(JSON.parse(revoke.body)).toEqual({ refreshToken: RT_1 });
  });

  it('logout không cookie: 204 + xóa cookie, không gọi Core_API; thiếu Origin: 403', async () => {
    const ok = await http()
      .post('/api/admin/auth/logout')
      .set('Origin', TEST_ORIGIN);
    expect(ok.status).toBe(204);
    expect(core.requests).toHaveLength(0);

    const blocked = await http()
      .post('/api/admin/auth/logout')
      .set('Cookie', `${COOKIE}=${RT_1}`);
    expect(blocked.status).toBe(403);
  });

  it('Core_API sập: 503 ProblemDetails, không lộ host', async () => {
    const dead = new FakeCore();
    await dead.start();
    const deadApp = await createTestApp(dead);
    const host = new URL(dead.url).host;
    await dead.stop();

    const res = await request(deadApp.getHttpServer())
      .post('/api/admin/auth/login')
      .send({ email: 'a@b.c', password: 'x' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('CoreUnavailable');
    expect(JSON.stringify(res.body)).not.toContain(host);
    await deadApp.close();
    process.env.CORE_API_URL = core.url;
  });
});
