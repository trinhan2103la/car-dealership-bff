import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/**
 * Chuẩn hóa Correlation_Id ở BFF, CÙNG quy ước với Core_API.
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

type RequestWithCorrelation = IncomingMessage & { correlationId?: string };

/**
 * MỘT Correlation_Id cho mỗi request, dù ai hỏi trước. pino-http (genReqId) chạy TRƯỚC middleware của Nest, nên trước đây
 * khi client không gửi header thì mỗi bên tự sinh một mã khác nhau (log và response lệch nhau). Giờ mã được gắn vào req
 * ở lần gọi đầu tiên và các lần sau dùng lại.
 */
export function ensureCorrelationId(req: IncomingMessage): string {
  const r = req as RequestWithCorrelation;
  if (r.correlationId) return r.correlationId;
  const incoming = req.headers?.[CORRELATION_ID_HEADER];
  r.correlationId = resolveCorrelationId(
    Array.isArray(incoming) ? incoming[0] : incoming,
  );
  return r.correlationId;
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    res.setHeader('X-Correlation-Id', ensureCorrelationId(req));
    next();
  }
}
