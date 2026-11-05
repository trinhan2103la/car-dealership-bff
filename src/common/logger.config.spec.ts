import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { buildLoggerParams, pathOnly, requestLine } from './logger.config.js';

describe('logger.config', () => {
  it('pathOnly bỏ query string (có thể chứa token)', () => {
    expect(pathOnly('/api/x?token=abc&b=1')).toBe('/api/x');
    expect(pathOnly('/api/x')).toBe('/api/x');
    expect(pathOnly(undefined)).toBe('/');
  });

  it('requestLine: method, path không query, status, thời gian, cid', () => {
    const req = { method: 'GET', url: '/api/admin/auth/me?x=1', id: 'cid-1' } as unknown as IncomingMessage;
    const res = { statusCode: 304 } as ServerResponse;
    expect(requestLine(req, res, 12.6)).toBe('GET /api/admin/auth/me 304 13ms cid=cid-1');
  });

  it('serializer req chỉ giữ method + path, không có header', () => {
    const http = buildLoggerParams().pinoHttp as {
      serializers: { req: (r: unknown) => unknown; res: (r: unknown) => unknown };
    };
    const out = http.serializers.req({
      method: 'POST',
      url: '/api/admin/auth/login?next=/x',
      headers: { cookie: 'cdp_sid=secret', authorization: 'Bearer t' },
    });
    expect(out).toEqual({ method: 'POST', path: '/api/admin/auth/login' });
    expect(JSON.stringify(out)).not.toContain('secret');
  });

  it('mức log theo status và bỏ Error giả của 5xx', () => {
    const http = buildLoggerParams().pinoHttp as {
      customLogLevel: (req: unknown, res: { statusCode: number }, err?: Error) => string;
      customErrorObject: (a: unknown, b: unknown, c: unknown, val: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(http.customLogLevel({}, { statusCode: 200 })).toBe('info');
    expect(http.customLogLevel({}, { statusCode: 403 })).toBe('warn');
    expect(http.customLogLevel({}, { statusCode: 503 })).toBe('error');
    expect(http.customErrorObject({}, {}, new Error('x'), { err: new Error('x'), a: 1 })).toEqual({ a: 1 });
  });
});
