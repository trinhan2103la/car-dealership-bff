import { generateKeyPairSync } from 'node:crypto';
import { decodeProtectedHeader, importSPKI, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  SERVICE_JWT_PRIVATE_KEY_VARIABLE,
  ServiceTokenSigner,
} from './service-token.signer.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const makeSigner = (value?: string) =>
  new ServiceTokenSigner({
    get: (name: string) => (name === SERVICE_JWT_PRIVATE_KEY_VARIABLE ? value : undefined),
  } as never);

describe('ServiceTokenSigner', () => {
  it('ký ES256 với claim iss/aud/jti/cid/scope và exp-iat=60', async () => {
    const token = await makeSigner(privatePem).sign('corr-123');
    expect(decodeProtectedHeader(token).alg).toBe('ES256');

    const { payload } = await jwtVerify(token, await importSPKI(publicPem, 'ES256'), {
      issuer: 'bff',
      audience: 'core-api',
    });
    expect(payload.cid).toBe('corr-123');
    expect(payload.scope).toBe('bff');
    expect(typeof payload.jti).toBe('string');
    expect(payload.exp! - payload.iat!).toBe(60);
  });

  it('mỗi token có jti khác nhau và hỗ trợ scope jobs', async () => {
    const signer = makeSigner(privatePem);
    const [a, b] = await Promise.all([signer.sign('c1'), signer.sign('c2', 'jobs')]);
    const key = await importSPKI(publicPem, 'ES256');
    const pa = (await jwtVerify(a, key)).payload;
    const pb = (await jwtVerify(b, key)).payload;
    expect(pa.jti).not.toBe(pb.jti);
    expect(pb.scope).toBe('jobs');
  });

  it('chấp nhận PEM một dòng với "\\n" literal', async () => {
    const oneLine = privatePem.trim().replace(/\n/g, '\\n');
    await expect(makeSigner(oneLine).sign('c')).resolves.toBeTypeOf('string');
  });

  it('chấp nhận base64 PKCS8 một dòng', async () => {
    const der = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
    await expect(makeSigner(der).sign('c')).resolves.toBeTypeOf('string');
  });

  it('thiếu khóa: lỗi nêu tên biến', async () => {
    await expect(makeSigner(undefined).sign('c')).rejects.toThrow(SERVICE_JWT_PRIVATE_KEY_VARIABLE);
  });

  it('khóa rác: lỗi không chứa nội dung khóa', async () => {
    const junk = 'not-a-key-SECRETVALUE';
    const error = await makeSigner(junk).sign('c').catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('SECRETVALUE');
  });

  it('khóa P-384 bị từ chối', async () => {
    const p384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1' })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    await expect(makeSigner(p384).sign('c')).rejects.toThrow(SERVICE_JWT_PRIVATE_KEY_VARIABLE);
  });
});
