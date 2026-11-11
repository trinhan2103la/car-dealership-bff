import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeCore, FakeReply, RecordedRequest } from './support/fake-core.js';
import {
  createTestApp,
  sessionHandler,
  SESSION_ID,
  USER_ID,
} from './support/app.js';

// GUID tuần tự kiểu ABP (nibble version/variant tùy ý, không phải UUID chuẩn RFC): mọi route có :id phải nhận.
const BRAND = '3a24dae8-72be-4e9d-4c25-889a08a320c7';
const MODEL = '3a24dae8-7470-e39f-668f-b851ada88e32';
const VARIANT = '3a24dae8-7a11-f2c3-1d4e-5f60718293a4';
const IMAGE = '3a24dae8-7b22-03d4-2e5f-60718293a4b5';

type Method = 'get' | 'post' | 'put' | 'delete';

/** Mọi route quản trị catalog của BFF (Ngày 90, 91) với route Core tương ứng và Permission yêu cầu. */
const ROUTES: {
  method: Method;
  bff: string;
  core: string;
  perm: 'Catalog.Edit' | 'Catalog.Publish';
  body?: object;
}[] = [
  {
    method: 'get',
    bff: '/api/admin/brands',
    core: '/api/catalog/brands',
    perm: 'Catalog.Edit',
  },
  {
    method: 'get',
    bff: `/api/admin/brands/${BRAND}`,
    core: `/api/catalog/brands/${BRAND}`,
    perm: 'Catalog.Edit',
  },
  {
    method: 'post',
    bff: '/api/admin/brands',
    core: '/api/catalog/brands',
    perm: 'Catalog.Edit',
    body: { name: 'Toyota', slug: 'toyota' },
  },
  {
    method: 'put',
    bff: `/api/admin/brands/${BRAND}`,
    core: `/api/catalog/brands/${BRAND}`,
    perm: 'Catalog.Edit',
    body: { name: 'Toyota', slug: 'toyota' },
  },
  {
    method: 'post',
    bff: `/api/admin/brands/${BRAND}/status`,
    core: `/api/catalog/brands/${BRAND}/status`,
    perm: 'Catalog.Edit',
    body: { status: 'Inactive' },
  },
  {
    method: 'get',
    bff: '/api/admin/car-models',
    core: '/api/catalog/car-models',
    perm: 'Catalog.Edit',
  },
  {
    method: 'get',
    bff: `/api/admin/car-models/${MODEL}`,
    core: `/api/catalog/car-models/${MODEL}`,
    perm: 'Catalog.Edit',
  },
  {
    method: 'get',
    bff: `/api/admin/car-models/${MODEL}/publish-check`,
    core: `/api/catalog/car-models/${MODEL}/publish-check`,
    perm: 'Catalog.Edit',
  },
  {
    method: 'post',
    bff: '/api/admin/car-models',
    core: '/api/catalog/car-models',
    perm: 'Catalog.Edit',
    body: { brandId: BRAND, name: 'Vios' },
  },
  {
    method: 'put',
    bff: `/api/admin/car-models/${MODEL}`,
    core: `/api/catalog/car-models/${MODEL}`,
    perm: 'Catalog.Edit',
    body: { name: 'Vios' },
  },
  {
    method: 'post',
    bff: `/api/admin/car-models/${MODEL}/transitions`,
    core: `/api/catalog/car-models/${MODEL}/transitions`,
    perm: 'Catalog.Publish',
    body: { to: 'Published' },
  },
  {
    method: 'get',
    bff: `/api/admin/car-models/${MODEL}/variants`,
    core: `/api/catalog/car-models/${MODEL}/variants`,
    perm: 'Catalog.Edit',
  },
  {
    method: 'get',
    bff: `/api/admin/car-models/${MODEL}/variants/${VARIANT}`,
    core: `/api/catalog/car-models/${MODEL}/variants/${VARIANT}`,
    perm: 'Catalog.Edit',
  },
  {
    method: 'post',
    bff: `/api/admin/car-models/${MODEL}/variants`,
    core: `/api/catalog/car-models/${MODEL}/variants`,
    perm: 'Catalog.Edit',
    body: { name: '1.5G' },
  },
  {
    method: 'put',
    bff: `/api/admin/car-models/${MODEL}/variants/${VARIANT}`,
    core: `/api/catalog/car-models/${MODEL}/variants/${VARIANT}`,
    perm: 'Catalog.Edit',
    body: { name: '1.5G' },
  },
  {
    method: 'post',
    bff: `/api/admin/car-models/${MODEL}/variants/${VARIANT}/transitions`,
    core: `/api/catalog/car-models/${MODEL}/variants/${VARIANT}/transitions`,
    perm: 'Catalog.Publish',
    body: { to: 'Published' },
  },
  {
    method: 'put',
    bff: `/api/admin/car-models/${MODEL}/images/order`,
    core: `/api/catalog/car-models/${MODEL}/images/order`,
    perm: 'Catalog.Edit',
    body: { imageIds: [IMAGE] },
  },
  {
    method: 'put',
    bff: `/api/admin/car-models/${MODEL}/images/${IMAGE}`,
    core: `/api/catalog/car-models/${MODEL}/images/${IMAGE}`,
    perm: 'Catalog.Edit',
    body: { alt: 'Ảnh mặt trước xe' },
  },
  {
    method: 'delete',
    bff: `/api/admin/car-models/${MODEL}/images/${IMAGE}`,
    core: `/api/catalog/car-models/${MODEL}/images/${IMAGE}`,
    perm: 'Catalog.Edit',
  },
];

const describeRoute = (r: (typeof ROUTES)[number]) =>
  `${r.method.toUpperCase()} ${r.bff}`;

function serviceClaims(req: RecordedRequest): Record<string, unknown> {
  const token = String(req.headers.authorization).replace(/^Bearer /, '');
  return JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
}

describe('Admin catalog proxy (e2e)', () => {
  const core = new FakeCore();
  let app: NestExpressApplication;
  let editorToken: string;
  let publisherToken: string;
  let coreReply: FakeReply;

  const login = async (permissions: string[]) => {
    core.handler = sessionHandler({ permissions });
    const res = await request(app.getHttpServer())
      .post('/api/admin/auth/login')
      .send({ email: 'admin@example.com', password: 'correct-horse-battery' });
    return res.body.accessToken as string;
  };

  const send = (r: (typeof ROUTES)[number], token?: string) => {
    let call = request(app.getHttpServer())[r.method](r.bff);
    if (token) call = call.set('Authorization', `Bearer ${token}`);
    return r.body ? call.send(r.body) : call;
  };

  beforeAll(async () => {
    await core.start();
    app = await createTestApp(core);
    editorToken = await login(['Catalog.Edit']);
    publisherToken = await login(['Catalog.Edit', 'Catalog.Publish']);
    const session = sessionHandler({
      permissions: ['Catalog.Edit', 'Catalog.Publish'],
    });
    core.handler = (req) =>
      req.url.startsWith('/api/catalog/') ? coreReply : session(req);
  });
  afterAll(async () => {
    await app.close();
    await core.stop();
  });
  beforeEach(() => {
    core.requests.length = 0;
    coreReply = { status: 200, body: { ok: true } };
  });

  const catalogRequests = () =>
    core.requests.filter((r) => r.url.startsWith('/api/catalog/'));

  describe('không có token → 401, không gọi Core_API', () => {
    it.each(ROUTES.map((r) => [describeRoute(r), r] as const))(
      '%s',
      async (_, route) => {
        const res = await send(route);
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('Unauthenticated');
        expect(core.requests).toHaveLength(0);
      },
    );
  });

  describe('chỉ có Catalog.Edit mà gọi /transitions → 403, không gọi Core_API', () => {
    const publishRoutes = ROUTES.filter((r) => r.perm === 'Catalog.Publish');
    it.each(publishRoutes.map((r) => [describeRoute(r), r] as const))(
      '%s',
      async (_, route) => {
        const res = await send(route, editorToken);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('Forbidden');
        expect(catalogRequests()).toHaveLength(0);
      },
    );
  });

  describe('đủ quyền → chuyển tiếp đúng route Core, giữ status, kèm sub/sid', () => {
    it.each(ROUTES.map((r) => [describeRoute(r), r] as const))(
      '%s',
      async (_, route) => {
        if (route.method === 'delete') coreReply = { status: 204 };
        const res = await send(
          route,
          route.perm === 'Catalog.Publish' ? publisherToken : editorToken,
        );

        expect(res.status).toBe(route.method === 'delete' ? 204 : 200);
        const sent = catalogRequests();
        expect(sent).toHaveLength(1);
        expect(sent[0].method).toBe(route.method.toUpperCase());
        expect(sent[0].url.split('?')[0]).toBe(route.core);
        const claims = serviceClaims(sent[0]);
        expect(claims.sub).toBe(USER_ID);
        expect(claims.sid).toBe(SESSION_ID);
      },
    );
  });

  it('{to: "Published"} → Core nhận {status: "Published", concurrencyStamp}', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/admin/car-models/${MODEL}/transitions`)
      .set('Authorization', `Bearer ${publisherToken}`)
      .send({ to: 'Published', concurrencyStamp: 'stamp-1' });

    expect(res.status).toBe(200);
    expect(JSON.parse(catalogRequests()[0].body)).toEqual({
      status: 'Published',
      concurrencyStamp: 'stamp-1',
    });
  });

  it('transition thiếu `to` → 400 errors.to, không gọi Core_API', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/admin/car-models/${MODEL}/variants/${VARIANT}/transitions`)
      .set('Authorization', `Bearer ${publisherToken}`)
      .send({ status: 'Published' });

    expect(res.status).toBe(400);
    expect(res.body.errors?.to).toBeDefined();
    expect(catalogRequests()).toHaveLength(0);
  });

  it('chỉ chuyển tiếp query đã biết', async () => {
    await request(app.getHttpServer())
      .get(
        '/api/admin/car-models?keyword=vios&page=2&brandId=' +
          BRAND +
          '&evil=1',
      )
      .set('Authorization', `Bearer ${editorToken}`);

    const url = new URL(catalogRequests()[0].url, 'http://core');
    expect(url.searchParams.get('keyword')).toBe('vios');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('brandId')).toBe(BRAND);
    expect(url.searchParams.has('evil')).toBe(false);
  });

  it('Core 409 Catalog:Duplicate {field: "slug"} → BFF 409 giữ code và field', async () => {
    coreReply = {
      status: 409,
      body: {
        error: {
          code: 'Catalog:Duplicate',
          message: "Giá trị của 'slug' đã tồn tại.",
          data: { field: 'slug' },
        },
      },
    };
    const res = await request(app.getHttpServer())
      .post('/api/admin/brands')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ name: 'Toyota', slug: 'toyota' });

    expect(res.status).toBe(409);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.code).toBe('Catalog:Duplicate');
    expect(res.body.field).toBe('slug');
  });

  it('Core 422 PublishValidationFailed có rules → BFF giữ đủ rules', async () => {
    const rules = [
      {
        code: 'SingleCoverImage',
        passed: false,
        message: 'Cần đúng một ảnh cover',
      },
      {
        code: 'HasPublishedVariant',
        passed: false,
        message: 'Cần ít nhất một phiên bản Published',
      },
    ];
    coreReply = {
      status: 422,
      body: {
        error: {
          code: 'Catalog:PublishValidationFailed',
          message: 'Chưa đủ điều kiện xuất bản.',
          data: { rules },
        },
      },
    };
    const res = await request(app.getHttpServer())
      .post(`/api/admin/car-models/${MODEL}/transitions`)
      .set('Authorization', `Bearer ${publisherToken}`)
      .send({ to: 'Published' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('Catalog:PublishValidationFailed');
    expect(res.body.rules).toEqual(rules);
  });

  it('Core 422 InvalidTransition → BFF giữ currentState và allowedTargets', async () => {
    coreReply = {
      status: 422,
      body: {
        error: {
          code: 'Catalog:InvalidTransition',
          data: {
            currentState: 'Draft',
            allowedTargets: ['Published', 'Archived'],
          },
        },
      },
    };
    const res = await request(app.getHttpServer())
      .post(`/api/admin/car-models/${MODEL}/transitions`)
      .set('Authorization', `Bearer ${publisherToken}`)
      .send({ to: 'Hidden' });

    expect(res.status).toBe(422);
    expect(res.body.currentState).toBe('Draft');
    expect(res.body.allowedTargets).toEqual(['Published', 'Archived']);
  });

  it('Core 422 BrandHasPublishedCarModels → BFF trả items', async () => {
    coreReply = {
      status: 422,
      body: {
        error: {
          code: 'Catalog:BrandHasPublishedCarModels',
          data: { items: [{ name: 'Vios', slug: 'vios' }] },
        },
      },
    };
    const res = await request(app.getHttpServer())
      .post(`/api/admin/brands/${BRAND}/status`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ status: 'Inactive' });

    expect(res.status).toBe(422);
    expect(res.body.items).toEqual([{ name: 'Vios', slug: 'vios' }]);
  });

  it('id không phải UUID → 400, không gọi Core_API', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/brands/not-a-uuid')
      .set('Authorization', `Bearer ${editorToken}`);
    expect(res.status).toBe(400);
    expect(catalogRequests()).toHaveLength(0);
  });
});
