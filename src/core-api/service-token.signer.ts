import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { importPKCS8, SignJWT, type CryptoKey } from 'jose';

/**
 * BFF ký Service_Credential ES256 sống 60 giây gửi Core_API.
 * Hằng số khớp `ServiceCredential` phía Core_API. Khóa riêng CHỈ đọc từ env, không bao giờ log.
 */
export const SERVICE_JWT_PRIVATE_KEY_VARIABLE = 'SERVICE_JWT_PRIVATE_KEY';
export const SERVICE_TOKEN_ISSUER = 'bff';
export const SERVICE_TOKEN_AUDIENCE = 'core-api';
export const SERVICE_TOKEN_LIFETIME_SECONDS = 60;

export type ServiceScope = 'bff' | 'jobs';

/** Danh tính Admin_User lấy từ access token đã kiểm (claim sub + sid). */
export interface AdminIdentity {
  userId: string;
  sessionId: string;
}

/** Chuẩn hóa giá trị env: PEM xuống dòng thật, "\n" literal, hoặc base64 một dòng của PKCS8 DER. */
export function normalizePrivateKey(value: string): string {
  const text = value.trim().replace(/\\r/g, '').replace(/\\n/g, '\n');
  if (text.includes('-----BEGIN')) {
    return text;
  }
  const body =
    text
      .replace(/\s+/g, '')
      .match(/.{1,64}/g)
      ?.join('\n') ?? '';
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
}

@Injectable()
export class ServiceTokenSigner {
  private keyPromise?: Promise<CryptoKey>;

  constructor(private readonly config: ConfigService) {}

  /**
   * Ký token mới cho một request. `correlationId` đưa vào claim `cid`.
   * Khi request thay mặt một Admin_User (access token đã kiểm), thêm `sub` (userId) + `sid` (mã phiên) để
   * Core_API tra phiên và thu hồi có hiệu lực ngay.
   */
  async sign(
    correlationId: string,
    scope: ServiceScope = 'bff',
    admin?: AdminIdentity,
  ): Promise<string> {
    const key = await this.getKey();
    const now = Math.floor(Date.now() / 1000);
    const jwt = new SignJWT({
      cid: correlationId,
      scope,
      ...(admin ? { sid: admin.sessionId } : {}),
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
      .setIssuer(SERVICE_TOKEN_ISSUER)
      .setAudience(SERVICE_TOKEN_AUDIENCE)
      .setJti(randomUUID())
      .setIssuedAt(now)
      .setExpirationTime(now + SERVICE_TOKEN_LIFETIME_SECONDS);
    if (admin) jwt.setSubject(admin.userId);
    return jwt.sign(key);
  }

  private getKey(): Promise<CryptoKey> {
    if (!this.keyPromise) {
      const raw = this.config.get<string>(SERVICE_JWT_PRIVATE_KEY_VARIABLE);
      if (!raw || raw.trim() === '') {
        return Promise.reject(
          new Error(`${SERVICE_JWT_PRIVATE_KEY_VARIABLE} thiếu hoặc rỗng`),
        );
      }
      // Lỗi không kèm nội dung khóa.
      this.keyPromise = importPKCS8(normalizePrivateKey(raw), 'ES256').catch(
        () => {
          this.keyPromise = undefined;
          throw new Error(
            `${SERVICE_JWT_PRIVATE_KEY_VARIABLE} không phải khóa riêng ECDSA P-256 (PKCS8)`,
          );
        },
      );
    }
    return this.keyPromise;
  }
}
