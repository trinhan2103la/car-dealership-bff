import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * Chống CSRF cho hai endpoint DUY NHẤT dựa vào cookie (`/refresh`, `/logout`). API còn lại dùng
 * `Authorization: Bearer` mà trình duyệt không tự gửi nên không cần.
 * - Bắt buộc header `Origin` khớp CHÍNH XÁC một giá trị trong `ALLOWED_ORIGINS` (phân tách dấu phẩy).
 * - Thiếu `Origin` → từ chối (trình duyệt luôn gửi Origin cho POST cross-origin lẫn same-origin hiện đại).
 * - Production thiếu `ALLOWED_ORIGINS` → từ chối mọi thứ (đóng mặc định). Dev mặc định cho Admin_Portal (Vite :5173)
 *   và Swagger UI của BFF (:3000).
 */
export const ALLOWED_ORIGINS_VARIABLE = 'ALLOWED_ORIGINS';
export const DEV_DEFAULT_ORIGINS = ['http://localhost:5173', 'http://localhost:3000'];

export function parseAllowedOrigins(value: string | undefined, isProduction: boolean): Set<string> {
  const list = (value ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter((o) => o.length > 0);
  return new Set(list.length > 0 ? list : isProduction ? [] : DEV_DEFAULT_ORIGINS);
}

@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed: Set<string>;

  constructor(config: ConfigService) {
    this.allowed = parseAllowedOrigins(
      config.get<string>(ALLOWED_ORIGINS_VARIABLE),
      config.get<string>('NODE_ENV') === 'production',
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || !this.allowed.has(origin)) {
      throw new ForbiddenException({ code: 'OriginNotAllowed', title: 'Yêu cầu bị từ chối (nguồn không hợp lệ)' });
    }
    return true;
  }
}
