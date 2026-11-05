import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, decodeJwt, decodeProtectedHeader, importPKCS8 } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_JWT_PRIVATE_KEY_VARIABLE,
  AccessTokenExpiredError,
  AccessTokenService,
  InvalidAccessTokenError,
} from './access-token.service.js';

const pem = (curve = 'prime256v1') =>
  generateKeyPairSync('ec', { namedCurve: curve }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const KEY = pem();
const CLAIMS = {
  userId: '11111111-1111-1111-1111-111111111111',
  sessionId: '22222222-2222-2222-2222-222222222222',
  email: 'admin@example.com',
  roles: ['SuperAdmin'],
  permissions: ['Catalog.Edit', 'Users.Manage'],
};

const service = (env: Record<string, string | undefined> = {}) =>
  new AccessTokenService({
    get: (k: string) => ({ [ADMIN_JWT_PRIVATE_KEY_VARIABLE]: KEY, ...env })[k],
  } as never);

/** Ký token bằng KEY nhưng tùy chỉnh claim/header để thử các nhánh từ chối. */
async function craft(
  payload: Record<string, unknown>,
  opts: { aud?: string; iss?: string; typ?: string; lifetime?: number; key?: string } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'ES256', typ: opts.typ ?? 'at+jwt' })
    .setIssuer(opts.iss ?? 'bff')
    .setAudience(opts.aud ?? 'admin-portal')
    .setJti('j')
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.lifetime ?? 600))
    .sign(await importPKCS8(opts.key ?? KEY, 'ES256'));
}

const valid = { sub: CLAIMS.userId, sid: CLAIMS.sessionId, email: CLAIMS.email, roles: [], perms: [] };

afterEach(() => vi.useRealTimers());

describe('AccessTokenService', () => {
  it('issue: ES256, kid, typ at+jwt, iss/aud/sub/sid/perms, sống đúng 600 s', async () => {
    const { accessToken, expiresIn } = await service().issue(CLAIMS);

    expect(expiresIn).toBe(600);
    const header = decodeProtectedHeader(accessToken);
    expect(header).toEqual(expect.objectContaining({ alg: 'ES256', typ: 'at+jwt' }));
    expect(header.kid).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const payload = decodeJwt(accessToken);
    expect(payload).toEqual(
      expect.objectContaining({ iss: 'bff', aud: 'admin-portal', sub: CLAIMS.userId, sid: CLAIMS.sessionId, perms: CLAIMS.permissions }),
    );
    expect(payload.exp! - payload.iat!).toBe(600);
  });

  it('verify trả lại đúng claim', async () => {
    const svc = service();
    const { accessToken } = await svc.issue(CLAIMS);
    await expect(svc.verify(accessToken)).resolves.toEqual(CLAIMS);
  });

  it('hết hạn (quá 10 phút + 5 s dung sai) → AccessTokenExpiredError; trong dung sai vẫn qua', async () => {
    const svc = service();
    const { accessToken } = await svc.issue(CLAIMS);
    vi.useFakeTimers({ toFake: ['Date'] });

    vi.setSystemTime(Date.now() + 603_000);
    await expect(svc.verify(accessToken)).resolves.toBeDefined();

    vi.setSystemTime(Date.now() + 10_000);
    await expect(svc.verify(accessToken)).rejects.toBeInstanceOf(AccessTokenExpiredError);
  });

  it.each([
    ['khóa khác', () => craft(valid, { key: pem() })],
    ['aud của Service_Credential', () => craft(valid, { aud: 'core-api' })],
    ['iss lạ', () => craft(valid, { iss: 'someone' })],
    ['typ JWT thường', () => craft(valid, { typ: 'JWT' })],
    ['sống quá 10 phút', () => craft(valid, { lifetime: 3600 })],
    ['thiếu sid', () => craft({ ...valid, sid: undefined })],
    ['sub không phải uuid', () => craft({ ...valid, sub: 'admin' })],
    ['perms không phải mảng chuỗi', () => craft({ ...valid, perms: 'Catalog.Edit' })],
  ])('từ chối: %s', async (_name, make) => {
    await expect(service().verify(await make())).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('từ chối alg none, rác và token quá dài', async () => {
    const none = `${Buffer.from('{"alg":"none","typ":"at+jwt"}').toString('base64url')}.${Buffer.from(JSON.stringify(valid)).toString('base64url')}.`;
    for (const token of [none, 'rac', '', 'a'.repeat(5000)]) {
      await expect(service().verify(token)).rejects.toBeInstanceOf(InvalidAccessTokenError);
    }
  });

  it('thiếu khóa / khóa P-384 / trùng khóa Service_Credential → lỗi chỉ nêu tên biến, không lộ khóa', async () => {
    await expect(service({ [ADMIN_JWT_PRIVATE_KEY_VARIABLE]: undefined }).issue(CLAIMS)).rejects.toThrow(
      ADMIN_JWT_PRIVATE_KEY_VARIABLE,
    );
    await expect(service({ [ADMIN_JWT_PRIVATE_KEY_VARIABLE]: pem('secp384r1') }).issue(CLAIMS)).rejects.toThrow(
      ADMIN_JWT_PRIVATE_KEY_VARIABLE,
    );
    const same = await service({ SERVICE_JWT_PRIVATE_KEY: KEY }).issue(CLAIMS).catch((e: Error) => e);
    expect((same as Error).message).toContain('phải khác SERVICE_JWT_PRIVATE_KEY');
    expect((same as Error).message).not.toContain('PRIVATE KEY-----');
  });
});
