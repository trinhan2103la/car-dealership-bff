import { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import {
  FakeCore,
  FakeReply,
  RecordedRequest,
  newTestPrivateKeyPem,
  TEST_EDGE_KEY,
} from './fake-core.js';

/** Refresh token đúng dạng 43 ký tự base64url (Core_API sinh). */
export const RT_1 = 'A'.repeat(43);
export const RT_2 = 'B'.repeat(43);
export const SESSION_ID = '33333333-3333-3333-3333-333333333333';
export const USER_ID = '11111111-1111-1111-1111-111111111111';
export const TEST_ORIGIN = 'http://localhost:5173';
export const SESSION_EXPIRES_AT = new Date(
  Date.now() + 7 * 86400_000,
).toISOString();

export const adminUser = (permissions: string[] = ['Catalog.Edit']) => ({
  userId: USER_ID,
  email: 'admin@example.com',
  roles: ['ContentEditor'],
  permissions,
});

const loginResult = (refreshToken: string | null, permissions: string[]) => ({
  refreshToken,
  sessionId: SESSION_ID,
  sessionExpiresAt: SESSION_EXPIRES_AT,
  ...adminUser(permissions),
});

/**
 * Core_API giả cho nhóm endpoint phiên:
 * - login đúng mật khẩu → RT_1; refresh RT_1 → RT_2; refresh RT_2 → grace (refreshToken null); còn lại 401.
 * - revoke bất kỳ token đúng dạng → 204. current cần Service JWT có sub/sid (BFF tự ký) → 200; `revoked` = true → 401.
 */
export function sessionHandler(
  options: { permissions?: string[]; revoked?: () => boolean } = {},
) {
  const permissions = options.permissions ?? ['Catalog.Edit'];
  return (req: RecordedRequest): FakeReply => {
    const body = req.body
      ? (JSON.parse(req.body) as Record<string, string>)
      : {};
    switch (`${req.method} ${req.url}`) {
      case 'POST /api/app/auth/sessions':
        return body.password === 'correct-horse-battery'
          ? { status: 200, body: loginResult(RT_1, permissions) }
          : {
              status: 401,
              body: {
                error: 'invalid_credentials',
                message: 'Email hoặc mật khẩu không đúng.',
              },
            };
      case 'POST /api/app/auth/sessions/refresh':
        if (body.refreshToken === RT_1)
          return { status: 200, body: loginResult(RT_2, permissions) };
        if (body.refreshToken === RT_2)
          return { status: 200, body: loginResult(null, permissions) };
        return { status: 401, body: { error: 'unauthenticated' } };
      case 'POST /api/app/auth/sessions/revoke':
        return { status: 204 };
      case 'GET /api/app/auth/sessions/current':
        return options.revoked?.()
          ? { status: 401, body: { error: 'unauthenticated' } }
          : {
              status: 200,
              body: { sessionId: SESSION_ID, ...adminUser(permissions) },
            };
      default:
        return { status: 404 };
    }
  };
}

/** Dựng app Nest thật (AppModule) trỏ vào Core_API giả. `env` đặt trước khi module khởi tạo. */
export async function createTestApp(
  core: FakeCore,
  env: Record<string, string> = {},
  controllers: Type<unknown>[] = [],
): Promise<NestExpressApplication> {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    CORE_API_URL: core.url,
    EDGE_KEY: TEST_EDGE_KEY,
    SERVICE_JWT_PRIVATE_KEY: newTestPrivateKeyPem(),
    ADMIN_JWT_PRIVATE_KEY: newTestPrivateKeyPem(),
    ALLOWED_ORIGINS: TEST_ORIGIN,
    AUTH_LOGIN_RATE_LIMIT: '1000',
    AUTH_REFRESH_RATE_LIMIT: '1000',
    ...env,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers,
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bufferLogs: true,
  });
  app.set('trust proxy', false);
  await app.init();
  return app;
}

/** Lấy cookie theo tên từ header Set-Cookie của response supertest. */
export function setCookie(
  res: { headers: Record<string, unknown> },
  name: string,
): string | undefined {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw)
    ? (raw as string[])
    : typeof raw === 'string'
      ? [raw]
      : [];
  return list.find((c) => c.startsWith(`${name}=`));
}
