import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CoreApiHttpError } from '../core-api/core-api.client.js';
import { toProblemDetails } from './problem-details.mapper.js';

/**
 * BFF giữ nguyên quyết định và chuẩn hóa lỗi của Core_API.
 */
const STATUSES = [400, 401, 403, 404, 409, 422, 500, 502, 503] as const;

const ident = fc.stringMatching(/^[a-z][A-Za-z0-9]{0,15}$/);
const host = fc
  .tuple(
    fc.stringMatching(/^[a-z]{3,10}$/),
    fc.constantFrom(
      'koyeb.app',
      'internal',
      'onrender.com',
      'svc.cluster.local',
    ),
  )
  .map(([a, b]) => `${a}.${b}`);
const stack = fc
  .tuple(fc.stringMatching(/^[A-Z][A-Za-z]{2,10}$/), fc.nat(500))
  .map(
    ([n, line]) =>
      `${n}Exception: boom\n   at ${n}.Run() in /src/${n}.cs:line ${line}`,
  );

/** Chuỗi "bẩn": hoặc rò rỉ (host/stack) hoặc lẫn host vào câu bình thường. */
const dirtyText = fc.oneof(
  stack,
  host,
  host.map((h) => `Không kết nối được tới ${h}:5432`),
  stack.map((s) => `Lỗi: ${s}`),
);
const text = fc.oneof(fc.stringMatching(/^[A-Za-z ]{1,40}$/), dirtyText);

const validationErrors = fc.array(
  fc.record({
    message: text,
    members: fc.array(ident, { minLength: 1, maxLength: 3 }),
  }),
  { maxLength: 6 },
);

const abpError = fc.record({
  status: fc.constantFrom(...STATUSES),
  error: fc.record({
    code: fc.option(fc.oneof(ident, dirtyText), { nil: undefined }),
    message: fc.option(text, { nil: undefined }),
    details: fc.option(dirtyText, { nil: undefined }),
    validationErrors: fc.option(validationErrors, { nil: undefined }),
  }),
});

const LEAK =
  /\bat\s+\S+\s*\(|\bat\s+\S+\s+in\s|Exception|[a-z]+\.(koyeb\.app|internal|onrender\.com|svc\.cluster\.local)|\n/;

// Property test chạy hàng trăm ca nên cho timeout rộng hơn mặc định 5 s của Vitest.
describe('chuẩn hóa lỗi BFF (property-based)', { timeout: 30_000 }, () => {
  it('giữ nguyên status, giữ nguyên tập trường lỗi, không rò rỉ stack/host', () => {
    fc.assert(
      fc.property(abpError, ({ status, error }) => {
        const p = toProblemDetails(
          new CoreApiHttpError(status, { error }),
          'cid-1',
        );

        // 1) Quyết định (status) được giữ nguyên.
        expect(p.status).toBe(status);
        expect(p.correlationId).toBe('cid-1');

        // 2) Lỗi theo trường: 400 giữ nguyên tập khóa; số thông điệp mỗi khóa cũng giữ nguyên.
        if (
          status === 400 &&
          error.validationErrors &&
          error.validationErrors.length > 0
        ) {
          const expected: Record<string, number> = {};
          for (const ve of error.validationErrors)
            for (const m of ve.members) expected[m] = (expected[m] ?? 0) + 1;
          expect(Object.keys(p.errors ?? {}).sort()).toEqual(
            Object.keys(expected).sort(),
          );
          for (const [k, count] of Object.entries(expected))
            expect(p.errors![k]).toHaveLength(count);
        } else {
          expect(p.errors).toBeUndefined();
        }

        // 3) Không rò rỉ.
        expect(JSON.stringify(p)).not.toMatch(LEAK);
        if (status >= 500) expect(p.detail).toBeUndefined();
      }),
      { numRuns: 300 },
    );
  });

  it('mọi giá trị bị ném (kể cả rác) đều cho ProblemDetails hợp lệ, không ném lại', () => {
    fc.assert(
      fc.property(fc.anything(), (thrown) => {
        const p = toProblemDetails(thrown, 'cid-2');
        expect(p.status).toBeGreaterThanOrEqual(400);
        expect(p.status).toBeLessThanOrEqual(599);
        expect(p.code).toMatch(/^[A-Za-z]/);
        expect(p.correlationId).toBe('cid-2');
      }),
      { numRuns: 200 },
    );
  });
});
