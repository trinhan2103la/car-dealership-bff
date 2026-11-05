import { Controller, Get, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequirePermission } from '../src/auth/jwt-auth.guard.js';
import { FakeCore } from './support/fake-core.js';
import { createTestApp, sessionHandler } from './support/app.js';

@Controller('api/admin/_test')
class ProbeController {
  @Get('catalog')
  @RequirePermission('Catalog.Edit')
  catalog() {
    return { ok: true };
  }

  @Post('publish')
  @RequirePermission('Catalog.Publish')
  publish() {
    return { ok: true };
  }

  @Post('open')
  open() {
    return { ok: true };
  }
}

/** 401/403 từ guard Bearer theo claim perms, 429 từ rate limit đăng nhập. */
describe('Permission guard (e2e)', () => {
  const core = new FakeCore();
  let app: NestExpressApplication;
  let accessToken: string;

  beforeAll(async () => {
    await core.start();
    app = await createTestApp(
      core,
      { AUTH_LOGIN_RATE_LIMIT: '3', AUTH_LOGIN_RATE_WINDOW_MS: '60000' },
      [ProbeController],
    );
    core.handler = sessionHandler({ permissions: ['Catalog.Edit'] });
    accessToken = (
      await request(app.getHttpServer())
        .post('/api/admin/auth/login')
        .set('X-Forwarded-For', '198.51.100.1')
        .send({ email: 'admin@example.com', password: 'correct-horse-battery' })
    ).body.accessToken;
  });
  afterAll(async () => {
    await app.close();
    await core.stop();
  });
  beforeEach(() => {
    core.requests.length = 0;
  });

  const bearer = { Authorization: '' };
  const auth = () => ({ ...bearer, Authorization: `Bearer ${accessToken}` });

  it('không có token → 401 Unauthenticated', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/admin/_test/catalog',
    );
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('Unauthenticated');
  });

  it('có token nhưng thiếu Permission → 403, không gọi Core_API', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/_test/publish')
      .set(auth());
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('Forbidden');
    expect(core.requests).toHaveLength(0);
  });

  it('đủ Permission → 200 (kiểm từ claim, không cần gọi Core_API)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/_test/catalog')
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(core.requests).toHaveLength(0);
  });

  it('POST không cần token/CSRF nếu route không đánh dấu @RequirePermission (không còn CsrfGuard toàn cục)', async () => {
    expect(
      (await request(app.getHttpServer()).post('/api/admin/_test/open')).status,
    ).toBe(201);
  });

  it('vượt ngưỡng đăng nhập → 429 + Retry-After + ProblemDetails, kể cả khi giả X-Forwarded-For', async () => {
    const attempt = (n: number) =>
      request(app.getHttpServer())
        .post('/api/admin/auth/login')
        .set('X-Forwarded-For', `203.0.113.${n}`) // không tin header khi chưa cấu hình proxy tin cậy
        .send({ email: 'a@b.c', password: 'wrong' });

    // Lần đăng nhập trong beforeAll đã dùng 1 lượt của cùng IP.
    for (let i = 1; i <= 2; i++) expect((await attempt(i)).status).toBe(401);

    const blocked = await attempt(99);
    expect(blocked.status).toBe(429);
    // Header CHUẨN Retry-After (RFC 9110), không chỉ Retry-After-login của throttler có tên.
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(blocked.body.code).toBe('RateLimited');
  });
});
