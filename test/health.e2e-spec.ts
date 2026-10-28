import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

/**
 * Ngày 17 (Req 22, 28.13): /health/live trả 200 và response có header X-Correlation-Id.
 */
describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bufferLogs: true });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live -> 200 + status ok + header X-Correlation-Id', async () => {
    const res = await request(app.getHttpServer()).get('/health/live');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.headers['x-correlation-id']).toBeDefined();
    expect(res.headers['x-correlation-id']).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
  });

  it('giữ nguyên X-Correlation-Id hợp lệ từ client', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/live')
      .set('X-Correlation-Id', 'abc-123_XYZ');

    expect(res.headers['x-correlation-id']).toBe('abc-123_XYZ');
  });

  it('sinh mới khi X-Correlation-Id không hợp lệ', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/live')
      .set('X-Correlation-Id', 'has space');

    expect(res.headers['x-correlation-id']).not.toBe('has space');
    expect(res.headers['x-correlation-id']).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
  });

  it('GET /health/ready -> 200', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready');
    expect(res.status).toBe(200);
  });
});
