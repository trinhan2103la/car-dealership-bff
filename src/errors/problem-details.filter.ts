import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  CORRELATION_ID_HEADER,
  resolveCorrelationId,
} from '../common/correlation-id.middleware.js';
import { toProblemDetails } from './problem-details.mapper.js';

/** Filter toàn cục, mọi lỗi ra ngoài đều là `application/problem+json` kèm correlationId. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { correlationId?: string }>();
    const res = http.getResponse<Response>();

    const correlationId =
      req.correlationId ??
      resolveCorrelationId(req.headers?.[CORRELATION_ID_HEADER]);
    const problem = toProblemDetails(exception, correlationId);

    // Chi tiết kỹ thuật chỉ ở log phía server (không bao giờ trong response).
    if (problem.status >= 500) {
      const name =
        exception instanceof Error ? exception.name : typeof exception;
      this.logger.error(
        { correlationId, status: problem.status, errorName: name },
        exception instanceof Error && !(exception as { kind?: string }).kind
          ? exception.stack
          : undefined,
      );
    }

    if (res.headersSent) return;
    if (problem.status === 429) ensureRetryAfter(res);
    res
      .status(problem.status)
      .type('application/problem+json')
      .send(JSON.stringify(problem));
  }
}

/**
 * @nestjs/throttler có tên (login, refresh) đặt header `Retry-After-<tên>`; client chuẩn chỉ hiểu `Retry-After`
 * (RFC 9110). Lấy giá trị lớn nhất trong các header có tên rồi đặt thêm header chuẩn.
 */
export function ensureRetryAfter(
  res: Pick<Response, 'getHeader' | 'getHeaderNames' | 'setHeader'>,
): void {
  if (res.getHeader('retry-after') !== undefined) return;
  const seconds = res
    .getHeaderNames()
    .filter((name) => name.toLowerCase().startsWith('retry-after-'))
    .map((name) => Number(res.getHeader(name)))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (seconds.length > 0)
    res.setHeader('Retry-After', String(Math.max(...seconds)));
}
