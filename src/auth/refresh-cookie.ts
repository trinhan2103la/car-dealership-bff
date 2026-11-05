import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

/**
 * Cookie refresh token `__Host-cdp_rt`.
 * - `HttpOnly`: JavaScript (kể cả mã XSS) không đọc được.
 * - `SameSite=Strict`: trình duyệt không gửi kèm request khởi phát từ site khác (lớp chống CSRF thứ nhất; lớp thứ hai là
 *   kiểm `Origin` ở OriginGuard).
 * - `__Host-` bắt buộc `Secure`, `Path=/`, KHÔNG `Domain`. Đổi lại BFF CHỈ đọc cookie này ở `/refresh` và `/logout`.
 * - `Expires` = hết hạn tuyệt đối của phiên (7 ngày từ lúc đăng nhập) do Core_API trả.
 * Dev trên HTTP thuần: AUTH_INSECURE_DEV_COOKIE=true (bị bỏ qua khi NODE_ENV=production) → cookie `cdp_rt` không Secure.
 */
export const REFRESH_COOKIE_NAME = '__Host-cdp_rt';
export const DEV_REFRESH_COOKIE_NAME = 'cdp_rt';
const REFRESH_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    let value = part.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      value = decodeURIComponent(value);
    } catch {
      continue;
    }
    // Giá trị đầu tiên thắng (tránh bị ghi đè bởi cookie trùng tên).
    if (name && !(name in result)) result[name] = value;
  }
  return result;
}

@Injectable()
export class RefreshCookie {
  readonly name: string;
  readonly secure: boolean;

  constructor(config: ConfigService) {
    const insecureDev =
      config.get<string>('AUTH_INSECURE_DEV_COOKIE') === 'true' && config.get<string>('NODE_ENV') !== 'production';
    this.name = insecureDev ? DEV_REFRESH_COOKIE_NAME : REFRESH_COOKIE_NAME;
    this.secure = !insecureDev;
  }

  /** Refresh token gốc từ cookie, hoặc undefined. Chỉ nhận đúng dạng 43 ký tự base64url (chặn rác trước khi gọi Core_API). */
  read(req: Request): string | undefined {
    const value = parseCookies(req.headers.cookie)[this.name];
    return value && REFRESH_TOKEN.test(value) ? value : undefined;
  }

  set(res: Response, refreshToken: string, expiresAt: Date): void {
    res.cookie(this.name, refreshToken, { ...this.options(), expires: expiresAt });
  }

  clear(res: Response): void {
    res.clearCookie(this.name, this.options());
  }

  private options() {
    return { httpOnly: true, secure: this.secure, sameSite: 'strict' as const, path: '/' };
  }
}
