import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import {
  calculateJwkThumbprint,
  errors,
  exportJWK,
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
  type CryptoKey,
} from 'jose';
import { normalizePrivateKey, SERVICE_JWT_PRIVATE_KEY_VARIABLE } from '../core-api/service-token.signer.js';

/**
 * Access token của Admin_Portal. BFF ký VÀ kiểm (ES256), Core_API không bao giờ thấy token này.
 * - Khóa riêng `ADMIN_JWT_PRIVATE_KEY`, BẮT BUỘC khác khóa Service_Credential (một khóa lộ không kéo theo khóa kia).
 * - Sống 10 phút; `iss=bff`, `aud=admin-portal` (khác `aud=core-api` của Service_Credential nên không dùng lẫn được).
 * - Claim: `sub` (userId), `sid` (mã phiên), `email`, `roles`, `perms`, `jti`, `iat`, `exp`; header `kid` để xoay khóa.
 */
export const ADMIN_JWT_PRIVATE_KEY_VARIABLE = 'ADMIN_JWT_PRIVATE_KEY';
export const ACCESS_TOKEN_ISSUER = 'bff';
export const ACCESS_TOKEN_AUDIENCE = 'admin-portal';
export const ACCESS_TOKEN_LIFETIME_SECONDS = 600;
export const ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS = 5;
const MAX_TOKEN_LENGTH = 4096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
  email: string;
  roles: string[];
  permissions: string[];
}

export interface IssuedAccessToken {
  accessToken: string;
  /** Giây. Client hẹn giờ refresh theo số này, không so `exp` với đồng hồ máy (tránh lệch giờ). */
  expiresIn: number;
}

/** Token đúng chữ ký nhưng đã hết hạn → client nên refresh. */
export class AccessTokenExpiredError extends Error {
  constructor() {
    super('Access token đã hết hạn');
    this.name = 'AccessTokenExpiredError';
  }
}

/** Mọi lỗi khác (sai chữ ký, sai aud/iss, alg lạ, thiếu claim, rác) → đăng nhập lại. */
export class InvalidAccessTokenError extends Error {
  constructor() {
    super('Access token không hợp lệ');
    this.name = 'InvalidAccessTokenError';
  }
}

interface KeyMaterial {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  kid: string;
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

@Injectable()
export class AccessTokenService {
  private keys?: Promise<KeyMaterial>;

  constructor(private readonly config: ConfigService) {}

  async issue(claims: AccessTokenClaims): Promise<IssuedAccessToken> {
    const { privateKey, kid } = await this.getKeys();
    const now = Math.floor(Date.now() / 1000);
    const accessToken = await new SignJWT({
      sid: claims.sessionId,
      email: claims.email,
      roles: claims.roles,
      perms: claims.permissions,
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid })
      .setIssuer(ACCESS_TOKEN_ISSUER)
      .setAudience(ACCESS_TOKEN_AUDIENCE)
      .setSubject(claims.userId)
      .setJti(randomUUID())
      .setIssuedAt(now)
      .setExpirationTime(now + ACCESS_TOKEN_LIFETIME_SECONDS)
      .sign(privateKey);
    return { accessToken, expiresIn: ACCESS_TOKEN_LIFETIME_SECONDS };
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    if (!token || token.length > MAX_TOKEN_LENGTH) throw new InvalidAccessTokenError();
    const { publicKey } = await this.getKeys();

    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(token, publicKey, {
        algorithms: ['ES256'],
        issuer: ACCESS_TOKEN_ISSUER,
        audience: ACCESS_TOKEN_AUDIENCE,
        typ: 'at+jwt',
        clockTolerance: ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS,
        requiredClaims: ['sub', 'sid', 'jti', 'iat', 'exp'],
      }));
    } catch (error) {
      if (error instanceof errors.JWTExpired) throw new AccessTokenExpiredError();
      throw new InvalidAccessTokenError();
    }

    const { sub, sid, email, roles, perms, iat, exp } = payload;
    if (
      typeof sub !== 'string' || !UUID.test(sub) ||
      typeof sid !== 'string' || !UUID.test(sid) ||
      typeof email !== 'string' || !isStringArray(roles) || !isStringArray(perms) ||
      typeof iat !== 'number' || typeof exp !== 'number' ||
      exp - iat > ACCESS_TOKEN_LIFETIME_SECONDS
    ) {
      throw new InvalidAccessTokenError();
    }

    return { userId: sub, sessionId: sid, email, roles, permissions: perms };
  }

  private getKeys(): Promise<KeyMaterial> {
    this.keys ??= this.loadKeys().catch((error: unknown) => {
      this.keys = undefined;
      throw error;
    });
    return this.keys;
  }

  private async loadKeys(): Promise<KeyMaterial> {
    const raw = this.config.get<string>(ADMIN_JWT_PRIVATE_KEY_VARIABLE);
    if (!raw || raw.trim() === '') {
      throw new Error(`${ADMIN_JWT_PRIVATE_KEY_VARIABLE} thiếu hoặc rỗng`);
    }
    const pem = normalizePrivateKey(raw);

    const service = this.config.get<string>(SERVICE_JWT_PRIVATE_KEY_VARIABLE);
    if (service && normalizePrivateKey(service).replace(/\s+/g, '') === pem.replace(/\s+/g, '')) {
      throw new Error(`${ADMIN_JWT_PRIVATE_KEY_VARIABLE} phải khác ${SERVICE_JWT_PRIVATE_KEY_VARIABLE}`);
    }

    try {
      const privateKey = await importPKCS8(pem, 'ES256');
      const spki = createPublicKey(createPrivateKey(pem)).export({ type: 'spki', format: 'pem' }).toString();
      const publicKey = await importSPKI(spki, 'ES256');
      const kid = await calculateJwkThumbprint(await exportJWK(publicKey));
      return { privateKey, publicKey, kid };
    } catch {
      // Không kèm nội dung khóa.
      throw new Error(`${ADMIN_JWT_PRIVATE_KEY_VARIABLE} không phải khóa riêng ECDSA P-256 (PKCS8)`);
    }
  }
}
