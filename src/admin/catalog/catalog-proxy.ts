import { BadRequestException, Injectable } from '@nestjs/common';
import { AdminRequest } from '../../auth/jwt-auth.guard.js';
import { CoreApiClient } from '../../core-api/core-api.client.js';

@Injectable()
export class CatalogProxy {
  constructor(private readonly core: CoreApiClient) {}

  /** Client gắn sub/sid của admin: Core_API tra phiên và kiểm Permission lần CUỐI (BFF chỉ kiểm sớm). */
  for(req: AdminRequest) {
    const admin = req.admin!;
    return this.core.for({
      correlationId: req.correlationId ?? 'unknown',
      admin: { userId: admin.userId, sessionId: admin.sessionId },
    });
  }
}

/** Chỉ chuyển tiếp các tham số query đã biết (không đẩy thẳng mọi thứ client gửi sang Core). */
export function pick(
  query: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    keys.filter((k) => query[k] !== undefined).map((k) => [k, query[k]]),
  );
}

/** 400 dạng ABP (validationErrors) để mapper trả `errors.{field}`. */
export function invalid(field: string, message: string) {
  return new BadRequestException({
    code: 'Validation',
    validationErrors: [{ message, members: [field] }],
  });
}

/**
 * Body chuyển trạng thái của Admin_Portal `{to, concurrencyStamp}` → body của Core_API `{status, concurrencyStamp}` (lệch C).
 * Thiếu `to` thì 400 ngay tại BFF, không gọi Core.
 */
export function toTransitionBody(body: unknown) {
  const b = (typeof body === 'object' && body !== null ? body : {}) as {
    to?: unknown;
    concurrencyStamp?: unknown;
  };
  if (typeof b.to !== 'string' || b.to.trim() === '')
    throw invalid('to', 'Thiếu trạng thái đích.');
  return { status: b.to, concurrencyStamp: b.concurrencyStamp };
}
