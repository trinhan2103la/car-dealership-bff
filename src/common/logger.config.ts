import { Params } from 'nestjs-pino';
import { IncomingMessage, ServerResponse } from 'node:http';
import { ensureCorrelationId } from './correlation-id.middleware.js';

/**
 * Mỗi request MỘT dòng log gọn.
 * - Trường cố định: service, environment, Correlation_Id, method, path, statusCode, responseTime (ms). Tương tự Core_API.
 * - KHÔNG log header và query string: không lọt cookie/token, và log đỡ rác (trước đây in toàn bộ header trình duyệt).
 * - Mức log theo status: 5xx → error, 4xx → warn, còn lại → info.
 * - 5xx không kèm stack giả "failed with status code 500" của pino-http; lỗi thật do ProblemDetailsFilter ghi riêng.
 * - Bỏ qua GET /health/live (health check của host gọi liên tục).
 * Dev: pino-pretty in một dòng dạng "GET /api/admin/auth/me 200 12ms cid=…". Prod: JSON thuần.
 */
type LoggedRequest = IncomingMessage & { id?: string; originalUrl?: string };

/** Chỉ lấy path, bỏ query (có thể chứa token gửi nhầm). */
export function pathOnly(url: string | undefined): string {
  if (!url) return '/';
  const index = url.indexOf('?');
  return index < 0 ? url : url.slice(0, index);
}

export function requestLine(
  req: IncomingMessage,
  res: ServerResponse,
  responseTime?: number,
): string {
  const r = req as LoggedRequest;
  const time =
    responseTime === undefined ? '' : ` ${Math.round(responseTime)}ms`;
  return `${req.method} ${pathOnly(r.originalUrl ?? req.url)} ${res.statusCode}${time} cid=${r.id ?? '-'}`;
}

export function buildLoggerParams(): Params {
  const isProd = process.env.NODE_ENV === 'production';

  return {
    pinoHttp: {
      level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
      base: {
        service: 'bff',
        environment: process.env.NODE_ENV ?? 'development',
      },
      // Cùng một mã với header response và với lời gọi sang Core_API (xem ensureCorrelationId).
      genReqId: (req: IncomingMessage) => ensureCorrelationId(req),
      customProps: (req: IncomingMessage) => ({
        Correlation_Id: (req as LoggedRequest).id,
      }),
      serializers: {
        req: (req: { method?: string; url?: string; raw?: LoggedRequest }) => ({
          method: req.method,
          path: pathOnly(req.raw?.originalUrl ?? req.url),
        }),
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      customSuccessMessage: (req, res, responseTime) =>
        requestLine(req, res, responseTime),
      customErrorMessage: (req, res) => requestLine(req, res),
      // Bỏ Error giả mà pino-http tự tạo cho 5xx (stack của chính pino-http, không giúp gì).
      customErrorObject: (_req, _res, _err, loggable) => {
        const { err: _drop, ...rest } = loggable as Record<string, unknown>;
        return rest;
      },
      autoLogging: {
        ignore: (req) =>
          req.method === 'GET' && pathOnly(req.url) === '/health/live',
      },
      // Phòng thủ: nếu sau này ai đó log req.headers thì header nhạy cảm vẫn bị loại.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-edge-key"]',
        ],
        remove: true,
      },
      transport: isProd
        ? undefined
        : {
            target: 'pino-pretty',
            options: {
              singleLine: true,
              translateTime: 'SYS:HH:MM:ss.l',
              // Dòng request đã đủ thông tin trong msg; ẩn các object trùng lặp.
              ignore:
                'pid,hostname,service,environment,req,res,responseTime,Correlation_Id',
            },
          },
    },
  };
}
