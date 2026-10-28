import { Params } from 'nestjs-pino';
import { IncomingMessage } from 'node:http';
import {
  CORRELATION_ID_HEADER,
  resolveCorrelationId,
} from './correlation-id.middleware.js';

/**
 * Ngày 17 (Req 22): cấu hình pino cho BFF — log JSON một dòng/sự kiện, có service + Correlation_Id.
 * Ở dev (NODE_ENV !== 'production') có thể bật pino-pretty cho dễ đọc; prod giữ JSON thuần.
 */
export function buildLoggerParams(): Params {
  const isProd = process.env.NODE_ENV === 'production';

  return {
    pinoHttp: {
      level: isProd ? 'info' : 'debug',
      // service + environment: 2 trường định danh cố định (tương tự Core_API).
      base: {
        service: 'bff',
        environment: process.env.NODE_ENV ?? 'development',
      },
      // Correlation_Id: lấy từ req (middleware đã gắn) hoặc từ header, fallback sinh mới.
      genReqId: (req: IncomingMessage) => {
        const fromReq = (req as IncomingMessage & { correlationId?: string })
          .correlationId;
        if (fromReq) {
          return fromReq;
        }
        return resolveCorrelationId(req.headers?.[CORRELATION_ID_HEADER]);
      },
      customProps: (req: IncomingMessage) => ({
        Correlation_Id: (req as IncomingMessage & { id?: string }).id,
      }),
      // Không log header nhạy cảm (authorization/cookie/edge key).
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-edge-key"]',
          'req.headers["x-admin-session"]',
        ],
        remove: true,
      },
      transport: isProd
        ? undefined
        : {
            target: 'pino-pretty',
            options: { singleLine: true, translateTime: 'SYS:standard' },
          },
    },
  };
}
