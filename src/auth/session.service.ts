import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  CoreApiClient,
  CoreApiHttpError,
  unwrap,
} from '../core-api/core-api.client.js';
import type { components } from '../core-api/generated/schema.js';
import type { AdminIdentity } from '../core-api/service-token.signer.js';

type RawLoginResult =
  components['schemas']['CarDealership.CoreService.Identity.LoginResultDto'];
type RawCurrentSession =
  components['schemas']['CarDealership.CoreService.Identity.CurrentSessionDto'];

export interface SessionUser {
  userId: string;
  email: string;
  roles: string[];
  permissions: string[];
}

/** Kết quả đăng nhập/refresh đã kiểm (OpenAPI của Core_API đánh dấu mọi trường là tùy chọn). */
export interface CoreLoginResult extends SessionUser {
  /** Null = grace 20 s khi refresh: giữ cookie cũ. */
  refreshToken: string | null;
  sessionId: string;
  sessionExpiresAt: Date;
}

const strings = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? [...v] : null;

function toUser(
  raw: RawCurrentSession | RawLoginResult | undefined,
): SessionUser | null {
  const roles = strings(raw?.roles);
  const permissions = strings(raw?.permissions);
  if (!raw?.userId || !raw.email || !roles || !permissions) return null;
  return { userId: raw.userId, email: raw.email, roles, permissions };
}

/** Response thiếu trường bắt buộc = Core_API trả sai hợp đồng → 502; không bao giờ ký token với dữ liệu thiếu. */
function toLoginResult(raw: RawLoginResult | undefined): CoreLoginResult {
  const user = toUser(raw);
  const expires = raw?.sessionExpiresAt ? new Date(raw.sessionExpiresAt) : null;
  if (!user || !raw?.sessionId || !expires || Number.isNaN(expires.getTime())) {
    throw new CoreApiHttpError(502, undefined);
  }
  return {
    ...user,
    refreshToken: raw.refreshToken ?? null,
    sessionId: raw.sessionId,
    sessionExpiresAt: expires,
  };
}

/**
 * Gọi nhóm endpoint phiên của Core_API. BFF KHÔNG giữ trạng thái phiên nào (không cache): Core_API là nơi giữ family
 * refresh token và quyết định thu hồi.
 */
@Injectable()
export class SessionService {
  constructor(private readonly core: CoreApiClient) {}

  async login(
    email: string,
    password: string,
    correlationId: string,
  ): Promise<CoreLoginResult> {
    const result = await this.core
      .for({ correlationId })
      .POST('/api/app/auth/sessions', { body: { email, password } });

    if (result.response.status === 401) {
      // Mọi thất bại cùng một thông điệp, không phân biệt lý do.
      throw new HttpException(
        {
          code: 'InvalidCredentials',
          title: 'Email hoặc mật khẩu không đúng.',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const data = toLoginResult(unwrap<RawLoginResult>(result));
    if (!data.refreshToken) throw new CoreApiHttpError(502, undefined);
    return data;
  }

  /** Null khi Core_API từ chối (hết hạn, thu hồi, dùng lại token, user Inactive). `refreshToken` null = grace, giữ cookie cũ. */
  async refresh(
    refreshToken: string,
    correlationId: string,
  ): Promise<CoreLoginResult | null> {
    const result = await this.core
      .for({ correlationId })
      .POST('/api/app/auth/sessions/refresh', { body: { refreshToken } });

    if (result.response.status === 401) return null;
    return toLoginResult(unwrap<RawLoginResult>(result));
  }

  /** Đăng xuất. Phiên đã chết (401) coi như đã đăng xuất. */
  async revoke(refreshToken: string, correlationId: string): Promise<void> {
    const result = await this.core
      .for({ correlationId })
      .POST('/api/app/auth/sessions/revoke', { body: { refreshToken } });
    if (result.response.status !== 401) unwrap(result);
  }

  /** Danh tính + quyền mới nhất theo sid/sub; null nếu phiên đã bị thu hồi/hết hạn (dù access token còn hạn). */
  async current(
    admin: AdminIdentity,
    correlationId: string,
  ): Promise<SessionUser | null> {
    const result = await this.core
      .for({ correlationId, admin })
      .GET('/api/app/auth/sessions/current');
    if (result.response.status === 401) return null;
    const user = toUser(unwrap<RawCurrentSession>(result));
    if (!user) throw new CoreApiHttpError(502, undefined);
    return user;
  }
}
