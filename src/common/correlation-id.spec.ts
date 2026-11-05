import type { IncomingMessage } from 'node:http';
import {
  ensureCorrelationId,
  resolveCorrelationId,
  CORRELATION_ID_REGEX,
} from './correlation-id.middleware.js';

/** Unit test resolver Correlation_Id (cùng luật với Core_API). */
describe('resolveCorrelationId', () => {
  it('giữ nguyên giá trị hợp lệ', () => {
    expect(resolveCorrelationId('abc-123_XYZ')).toBe('abc-123_XYZ');
  });

  it('sinh mới khi thiếu', () => {
    const id = resolveCorrelationId(undefined);
    expect(CORRELATION_ID_REGEX.test(id)).toBe(true);
  });

  it('sinh mới khi quá 128 ký tự', () => {
    const tooLong = 'a'.repeat(129);
    const id = resolveCorrelationId(tooLong);
    expect(id).not.toBe(tooLong);
    expect(CORRELATION_ID_REGEX.test(id)).toBe(true);
  });

  it.each(['has space', 'semi;colon', 'slash/here', 'new\nline'])(
    'sinh mới khi ký tự lạ: %s',
    (bad) => {
      const id = resolveCorrelationId(bad);
      expect(id).not.toBe(bad);
      expect(CORRELATION_ID_REGEX.test(id)).toBe(true);
    },
  );
});

/** Lỗi thật gặp khi chạy E2E: pino-http và middleware mỗi bên tự sinh một mã khác nhau cho cùng request. */
describe('ensureCorrelationId', () => {
  const req = (headers: Record<string, string> = {}) => ({ headers }) as unknown as IncomingMessage;

  it('không có header: mọi lần gọi trên CÙNG request trả cùng một mã', () => {
    const r = req();
    const first = ensureCorrelationId(r);
    expect(ensureCorrelationId(r)).toBe(first);
    expect(first).toMatch(CORRELATION_ID_REGEX);
  });

  it('có header hợp lệ: dùng đúng header', () => {
    expect(ensureCorrelationId(req({ 'x-correlation-id': 'abc-1' }))).toBe('abc-1');
  });

  it('hai request khác nhau có mã khác nhau', () => {
    expect(ensureCorrelationId(req())).not.toBe(ensureCorrelationId(req()));
  });
});
