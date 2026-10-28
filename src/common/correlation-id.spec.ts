import {
  resolveCorrelationId,
  CORRELATION_ID_REGEX,
} from './correlation-id.middleware.js';

/** Ngày 17: unit test resolver Correlation_Id (cùng luật với Core_API). */
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
