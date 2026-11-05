import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { setupSwagger } from '../src/docs/swagger.js';
import { FakeCore, newTestPrivateKeyPem, TEST_EDGE_KEY } from './support/fake-core.js';

/** Swagger UI chỉ có khi NODE_ENV !== 'production'. */
async function createApp(nodeEnv: string): Promise<NestExpressApplication> {
  process.env.NODE_ENV = nodeEnv;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  setupSwagger(app);
  await app.init();
  return app;
}

describe('Swagger (e2e)', () => {
  const core = new FakeCore();
  const originalEnv = process.env.NODE_ENV;
  let app: NestExpressApplication | undefined;

  beforeAll(async () => {
    await core.start();
    Object.assign(process.env, {
      CORE_API_URL: core.url,
      EDGE_KEY: TEST_EDGE_KEY,
      SERVICE_JWT_PRIVATE_KEY: newTestPrivateKeyPem(),
      ADMIN_JWT_PRIVATE_KEY: newTestPrivateKeyPem(),
    });
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });
  afterAll(async () => {
    process.env.NODE_ENV = originalEnv;
    await core.stop();
  });

  it('dev: /docs trả Swagger UI, /docs-json mô tả đủ route auth + security scheme', async () => {
    app = await createApp('development');
    const ui = await request(app.getHttpServer()).get('/docs/');
    expect(ui.status).toBe(200);
    expect(ui.text).toContain('swagger');

    const json = await request(app.getHttpServer()).get('/docs-json');
    expect(json.status).toBe(200);
    const doc = json.body;
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/api/admin/auth/login', '/api/admin/auth/logout', '/api/admin/auth/me', '/health/live']),
    );
    // Chỉ còn Bearer; không còn session cookie / CSRF apiKey.
    expect(Object.keys(doc.components.securitySchemes)).toEqual(['access-token']);
    expect(doc.components.securitySchemes['access-token']).toEqual(expect.objectContaining({ type: 'http', scheme: 'bearer' }));
    expect(doc.paths['/api/admin/auth/me'].get.security).toEqual([{ 'access-token': [] }]);
    expect(Object.keys(doc.paths)).toContain('/api/admin/auth/refresh');
    expect(doc.paths['/api/admin/auth/login'].post.requestBody).toBeDefined();
    expect(doc.components.schemas).toHaveProperty('ProblemDetailsDto');
  });

  it('production: /docs và /docs-json đều 404 ProblemDetails', async () => {
    app = await createApp('production');
    for (const path of ['/docs/', '/docs-json']) {
      const res = await request(app.getHttpServer()).get(path);
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toContain('application/problem+json');
    }
  });
});
