import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { toProblemDetails } from '../errors/problem-details.mapper.js';
import { ParseGuidPipe } from './parse-guid.pipe.js';

const pipe = new ParseGuidPipe();
const meta = { type: 'param' as const, data: 'carModelId' };

describe('ParseGuidPipe', () => {
  it.each([
    // GUID tuần tự của ABP lấy từ DB thật: nibble version/variant không theo RFC (ParseUUIDPipe từ chối 2 cái đầu).
    '3a24dae8-7470-e39f-668f-b851ada88e32',
    '3a24dae8-72be-4e9d-4c25-889a08a320c7',
    '3a24dae8-732f-311f-99da-a3954ae29511',
    '4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
    '00000000-0000-0000-0000-000000000000',
  ])('nhận GUID .NET %s', (id) => {
    expect(pipe.transform(id, meta)).toBe(id);
  });

  it('chuẩn hóa về chữ thường', () => {
    expect(pipe.transform('3A24DAE8-7470-E39F-668F-B851ADA88E32', meta)).toBe(
      '3a24dae8-7470-e39f-668f-b851ada88e32',
    );
  });

  it.each([
    'not-a-uuid',
    '',
    '3a24dae8-7470-e39f-668f-b851ada88e3',
    '3a24dae87470e39f668fb851ada88e32',
    '{3a24dae8-7470-e39f-668f-b851ada88e32}',
    '3a24dae8-7470-e39f-668f-b851ada88e3z',
    123,
    undefined,
  ])('từ chối %s → 400 errors.{tham số}', (value) => {
    let thrown: unknown;
    try {
      pipe.transform(value, meta);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(BadRequestException);
    const problem = toProblemDetails(thrown, 'cid');
    expect(problem.status).toBe(400);
    expect(problem.errors).toEqual({ carModelId: ['Định danh không hợp lệ.'] });
  });
});
