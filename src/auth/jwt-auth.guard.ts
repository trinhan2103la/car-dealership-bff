import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AccessTokenClaims, AccessTokenExpiredError, AccessTokenService } from './access-token.service.js';

/** 9 Permission cố định (khớp `AppPermissions` của Core_API). */
export type Permission =
  | 'Catalog.Edit'
  | 'Catalog.Publish'
  | 'Leads.View'
  | 'Leads.Manage'
  | 'Showrooms.Manage'
  | 'Users.Manage'
  | 'Settings.Manage'
  | 'AuditLog.View'
  | 'Analytics.View';

export const REQUIRE_PERMISSION_KEY = 'cdp:require-permission';

/**
 * Route cần access token (Bearer). Gọi không tham số = chỉ cần đăng nhập. Kiểm SỚM theo claim `perms`;
 * Core_API vẫn là nơi quyết định cuối (tra phiên theo `sid` + Permission ABP ở mỗi request).
 */
export const RequirePermission = (...permissions: Permission[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permissions);

export type AdminRequest = Request & { admin?: AccessTokenClaims; correlationId?: string };

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

/**
 * Guard toàn cục. Chỉ áp cho route có @RequirePermission.
 * - Thiếu/sai token → 401 `Unauthenticated` (client về trang đăng nhập).
 * - Token đúng nhưng hết hạn → 401 `TokenExpired` (client refresh MỘT lần rồi gửi lại).
 * - Thiếu Permission → 403 `Forbidden`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(REQUIRE_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<AdminRequest>();
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? BEARER.exec(header) : null;
    if (!match) throw new UnauthorizedException({ code: 'Unauthenticated' });

    let claims: AccessTokenClaims;
    try {
      claims = await this.tokens.verify(match[1]);
    } catch (error) {
      throw new UnauthorizedException({
        code: error instanceof AccessTokenExpiredError ? 'TokenExpired' : 'Unauthenticated',
      });
    }

    if (!required.every((p) => claims.permissions.includes(p))) {
      throw new ForbiddenException({ code: 'Forbidden' });
    }

    req.admin = claims;
    return true;
  }
}
