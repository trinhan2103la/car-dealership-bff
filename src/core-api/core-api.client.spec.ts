import { importSPKI, jwtVerify } from 'jose';
import { createPublicKey, createPrivateKey } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  FakeCore,
  newTestPrivateKeyPem,
  TEST_EDGE_KEY,
} from '../../test/support/fake-core.js';
import {
  CoreApiClient,
  CoreApiHttpError,
  CoreApiUnavailableError,
  unwrap,
} from './core-api.client.js';
import { ServiceTokenSigner } from './service-token.signer.js';

const privatePem = newTestPrivateKeyPem();
const publicPem = createPublicKey(createPrivateKey(privatePem))
  .export({ type: 'spki', format: 'pem' })
  .toString();

const core = new FakeCore();

function makeClient(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {
    CORE_API_URL: core.url,
    EDGE_KEY: TEST_EDGE_KEY,
    SERVICE_JWT_PRIVATE_KEY: privatePem,
    ...overrides,
  };
  const config = { get: (name: string) => env[name] } as never;
  return new CoreApiClient(config, new ServiceTokenSigner(config));
}

beforeAll(() => core.start());
afterAll(() => core.stop());
beforeEach(() => {
  core.requests.length = 0;
  core.handler = () => ({ status: 200, body: {} });
});

describe('CoreApiClient', () => {
  it('gắn đủ 3 header: X-Edge-Key, Authorization, X-Correlation-Id; không có X-Admin-Session', async () => {
    await makeClient()
      .for({ correlationId: 'corr-1' })
      .GET('/api/app/auth/sessions/current');

    const headers = core.requests[0].headers;
    expect(headers['x-edge-key']).toBe(TEST_EDGE_KEY);
    expect(headers['x-correlation-id']).toBe('corr-1');
    expect(headers['x-admin-session']).toBeUndefined();
    expect(headers['authorization']).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it('thay mặt admin: Service JWT có sub = userId và sid = sessionId', async () => {
    const admin = {
      userId: '11111111-1111-1111-1111-111111111111',
      sessionId: '22222222-2222-2222-2222-222222222222',
    };
    await makeClient()
      .for({ correlationId: 'c', admin })
      .GET('/api/app/auth/sessions/current');

    const token = String(core.requests[0].headers['authorization']).slice(7);
    const { payload } = await jwtVerify(
      token,
      await importSPKI(publicPem, 'ES256'),
    );
    expect(payload.sub).toBe(admin.userId);
    expect(payload.sid).toBe(admin.sessionId);
  });

  it('Authorization là JWT ES256 hợp lệ: iss/aud/scope/cid, sống 60 s', async () => {
    await makeClient()
      .for({ correlationId: 'corr-2' })
      .GET('/api/app/auth/sessions/current');

    const token = String(core.requests[0].headers['authorization']).slice(
      'Bearer '.length,
    );
    const { payload } = await jwtVerify(
      token,
      await importSPKI(publicPem, 'ES256'),
      {
        issuer: 'bff',
        audience: 'core-api',
      },
    );
    expect(payload.cid).toBe('corr-2');
    expect(payload.scope).toBe('bff');
    expect(payload.exp! - payload.iat!).toBe(60);
  });

  it('mỗi request có jti khác nhau', async () => {
    const client = makeClient();
    await client
      .for({ correlationId: 'c' })
      .GET('/api/app/auth/sessions/current');
    await client
      .for({ correlationId: 'c' })
      .GET('/api/app/auth/sessions/current');

    expect(core.requests[0].headers['authorization']).not.toBe(
      core.requests[1].headers['authorization'],
    );
  });

  it('scope jobs được chuyển vào JWT', async () => {
    await makeClient()
      .for({ correlationId: 'c', scope: 'jobs' })
      .GET('/api/app/auth/sessions/current');
    const token = String(core.requests[0].headers['authorization']).slice(7);
    const { payload } = await jwtVerify(
      token,
      await importSPKI(publicPem, 'ES256'),
    );
    expect(payload.scope).toBe('jobs');
  });

  it('unwrap ném CoreApiHttpError giữ status + body khi Core_API trả lỗi', async () => {
    core.handler = () => ({ status: 401, body: { error: 'unauthenticated' } });
    const result = await makeClient()
      .for({ correlationId: 'c' })
      .GET('/api/app/auth/sessions/current');

    const error = (() => {
      try {
        unwrap(result);
      } catch (e) {
        return e as CoreApiHttpError;
      }
    })();
    expect(error).toBeInstanceOf(CoreApiHttpError);
    expect(error!.status).toBe(401);
    expect(error!.body).toEqual({ error: 'unauthenticated' });
  });

  it('timeout: ném CoreApiUnavailableError(timeout), thông điệp không chứa host', async () => {
    core.handler = () => ({ status: 200, body: {}, delayMs: 500 });
    const error = await makeClient({ CORE_API_TIMEOUT_MS: '50' })
      .for({ correlationId: 'c' })
      .GET('/api/app/auth/sessions/current')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CoreApiUnavailableError);
    expect((error as CoreApiUnavailableError).kind).toBe('timeout');
    expect((error as Error).message).not.toContain('127.0.0.1');
  });

  it('lỗi mạng: kind=network, không lộ host/cổng', async () => {
    const error = await makeClient({ CORE_API_URL: 'http://127.0.0.1:1' })
      .for({ correlationId: 'c' })
      .GET('/api/app/auth/sessions/current')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CoreApiUnavailableError);
    expect((error as CoreApiUnavailableError).kind).toBe('network');
    expect(JSON.stringify(error)).not.toContain('127.0.0.1');
    expect((error as Error).message).not.toContain('127.0.0.1');
    expect((error as Error).cause).toBeUndefined();
  });

  it('thiếu CORE_API_URL hoặc EDGE_KEY: not_configured', () => {
    expect(() =>
      makeClient({ CORE_API_URL: undefined }).for({ correlationId: 'c' }),
    ).toThrow(CoreApiUnavailableError);
    expect(() =>
      makeClient({ EDGE_KEY: undefined }).for({ correlationId: 'c' }),
    ).toThrow(CoreApiUnavailableError);
  });
});
