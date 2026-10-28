import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * Ngày 17 (Req 22.2–22.5): chuẩn hóa Correlation_Id ở BFF, CÙNG quy ước với Core_API.
 * - Header: X-Correlation-Id.
 * - Hợp lệ (^[A-Za-z0-9_-]{1,128}$) thì giữ; thiếu/không hợp lệ thì sinh mới (chống log injection).
 * - Gắn vào req để logger (pino) đọc; trả lại trong response header.
 */
export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const CORRELATION_ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

export function resolveCorrelationId(incoming: unknown): string {
  if (typeof incoming === 'string' && CORRELATION_ID_REGEX.test(incoming)) {
    return incoming;
  }
  // 32 ký tự hex (bỏ dấu '-') -> hợp lệ với regex.
  return randomUUID().replace(/-/g, '');
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[CORRELATION_ID_HEADER];
    const value = Array.isArray(incoming) ? incoming[0] : incoming;
    const correlationId = resolveCorrelationId(value);

    // Gắn vào req để pino-http genReqId đọc được.
    (req as Request & { correlationId?: string }).correlationId = correlationId;
    res.setHeader('X-Correlation-Id', correlationId);

    next();
  }
}
