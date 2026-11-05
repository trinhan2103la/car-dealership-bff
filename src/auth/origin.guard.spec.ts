import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { DEV_DEFAULT_ORIGINS, OriginGuard, parseAllowedOrigins } from './origin.guard.js';

const guard = (env: Record<string, string | undefined>) => new OriginGuard({ get: (k: string) => env[k] } as never);
const ctx = (origin?: string) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ headers: origin ? { origin } : {} }) }) }) as never;

describe('OriginGuard', () => {
  it('cho qua đúng Origin trong ALLOWED_ORIGINS (bỏ dấu / cuối, khoảng trắng)', () => {
    const g = guard({ ALLOWED_ORIGINS: ' https://admin.example.com/ , https://www.example.com' });
    expect(g.canActivate(ctx('https://admin.example.com'))).toBe(true);
    expect(g.canActivate(ctx('https://www.example.com'))).toBe(true);
  });

  it.each([undefined, 'https://evil.example', 'https://admin.example.com.evil.example', 'http://admin.example.com', 'null'])(
    'từ chối Origin %s',
    (origin) => {
      expect(() => guard({ ALLOWED_ORIGINS: 'https://admin.example.com' }).canActivate(ctx(origin))).toThrow(
        ForbiddenException,
      );
    },
  );

  it('dev không cấu hình: mặc định Vite :5173 và Swagger :3000', () => {
    expect([...parseAllowedOrigins(undefined, false)]).toEqual(DEV_DEFAULT_ORIGINS);
  });

  it('production không cấu hình: từ chối mọi Origin (đóng mặc định)', () => {
    expect(parseAllowedOrigins('', true).size).toBe(0);
    expect(() => guard({ NODE_ENV: 'production' }).canActivate(ctx('http://localhost:5173'))).toThrow(ForbiddenException);
  });
});
