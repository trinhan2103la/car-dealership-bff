import {
  BadRequestException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { describe, expect, it } from 'vitest';
import {
  CoreApiHttpError,
  CoreApiUnavailableError,
} from '../core-api/core-api.client.js';
import { toProblemDetails } from './problem-details.mapper.js';

const CID = 'corr-abc';
const STACK = 'System.Exception: boom\n   at Foo.Bar() in /src/Foo.cs:line 12';
const HOST = 'core-xyz.koyeb.app';

const abp = (status: number, error: Record<string, unknown>) =>
  new CoreApiHttpError(status, { error });

describe('toProblemDetails', () => {
  const table: [string, unknown, number, string][] = [
    ['400 validation', abp(400, { message: 'Dữ liệu sai' }), 400, 'Validation'],
    ['401', abp(401, { message: 'x' }), 401, 'Unauthenticated'],
    ['403', abp(403, { message: 'x' }), 403, 'Forbidden'],
    ['404', abp(404, { message: 'x' }), 404, 'NotFound'],
    [
      '409 concurrency',
      abp(409, { message: 'Dữ liệu đã đổi' }),
      409,
      'Conflict',
    ],
    ['422', abp(422, { message: 'Sai quy tắc' }), 422, 'BusinessRule'],
    ['500', abp(500, { message: STACK }), 500, 'InternalError'],
    ['502', abp(502, {}), 502, 'CoreUnavailable'],
    ['503', abp(503, {}), 503, 'CoreUnavailable'],
    [
      'Core timeout',
      new CoreApiUnavailableError('timeout'),
      504,
      'CoreTimeout',
    ],
    [
      'Core network',
      new CoreApiUnavailableError('network'),
      503,
      'CoreUnavailable',
    ],
    [
      'Core not_configured',
      new CoreApiUnavailableError('not_configured'),
      503,
      'CoreUnavailable',
    ],
    [
      'Nest 404',
      new NotFoundException(`Cannot GET /secret/${HOST}`),
      404,
      'NotFound',
    ],
    ['Nest 429', new ThrottlerException(), 429, 'RateLimited'],
    [
      'lỗi lạ',
      new TypeError(`ECONNREFUSED ${HOST}:443\n    at connect (net.js:1:1)`),
      500,
      'InternalError',
    ],
    ['throw chuỗi', 'oops', 500, 'InternalError'],
  ];

  it.each(table)(
    '%s → status %i, code %s, có correlationId, không rò rỉ',
    (_n, err, status, code) => {
      const p = toProblemDetails(err, CID);
      expect(p.status).toBe(status);
      expect(p.code).toBe(code);
      expect(p.correlationId).toBe(CID);
      expect(p.type).toMatch(/^https:\/\/cdp\.example\/errors\//);
      const json = JSON.stringify(p);
      expect(json).not.toMatch(/\bat /);
      expect(json).not.toContain(HOST);
      expect(json).not.toContain('Exception');
    },
  );

  it('400: giữ lỗi theo trường {field: [message]}', () => {
    const p = toProblemDetails(
      abp(400, {
        message: 'Validation failed',
        validationErrors: [
          { message: 'Số điện thoại không hợp lệ', members: ['phone'] },
          { message: 'Bắt buộc', members: ['phone', 'name'] },
        ],
      }),
      CID,
    );
    expect(p.errors).toEqual({
      phone: ['Số điện thoại không hợp lệ', 'Bắt buộc'],
      name: ['Bắt buộc'],
    });
  });

  it('400: thông điệp trường chứa host/stack bị thay bằng thông điệp chung, giữ khóa trường', () => {
    const p = toProblemDetails(
      abp(400, {
        validationErrors: [{ message: `lỗi tại ${HOST}`, members: ['email'] }],
      }),
      CID,
    );
    expect(p.errors).toEqual({ email: ['Giá trị không hợp lệ'] });
  });

  it('422: giữ rules, currentState, allowedTargets và mã ổn định của Core_API', () => {
    const p = toProblemDetails(
      abp(422, {
        code: 'Catalog:InvalidTransition',
        message: 'Chuyển trạng thái không hợp lệ',
        data: {
          currentState: 'Draft',
          allowedTargets: ['Published', 'Archived'],
          rules: [
            {
              code: 'Catalog:CoverImageRequired',
              passed: false,
              message: 'Cần đúng một ảnh cover',
            },
          ],
        },
      }),
      CID,
    );
    expect(p.code).toBe('Catalog:InvalidTransition');
    expect(p.currentState).toBe('Draft');
    expect(p.allowedTargets).toEqual(['Published', 'Archived']);
    expect(p.rules).toEqual([
      {
        code: 'Catalog:CoverImageRequired',
        passed: false,
        message: 'Cần đúng một ảnh cover',
      },
    ]);
  });

  it('5xx không bao giờ có detail; 401/403/404 không lộ message của Core_API', () => {
    for (const status of [401, 403, 404, 500, 503]) {
      expect(
        toProblemDetails(
          abp(status, { message: 'Tên người dùng abc không tồn tại' }),
          CID,
        ).detail,
      ).toBeUndefined();
    }
  });

  it('HttpException do ta ném (có code/title) được giữ; message Nest tự sinh thì bỏ', () => {
    const own = toProblemDetails(
      new HttpException(
        {
          code: 'InvalidCredentials',
          title: 'Email hoặc mật khẩu không đúng.',
        },
        401,
      ),
      CID,
    );
    expect(own.code).toBe('InvalidCredentials');
    expect(own.title).toBe('Email hoặc mật khẩu không đúng.');

    const validation = toProblemDetails(
      new BadRequestException({
        code: 'Validation',
        validationErrors: [{ message: 'Bắt buộc', members: ['email'] }],
      }),
      CID,
    );
    expect(validation.errors).toEqual({ email: ['Bắt buộc'] });
  });

  it('status ngoài 400–599 từ upstream được đổi thành 500', () => {
    expect(
      toProblemDetails(new CoreApiHttpError(302, undefined), CID).status,
    ).toBe(500);
  });

  it('409 trùng: giữ code và field hợp lệ; field lạ hoặc ở status khác thì bỏ', () => {
    const dup = toProblemDetails(
      abp(409, {
        code: 'Catalog:Duplicate',
        message: "Giá trị của 'slug' đã tồn tại.",
        data: { field: 'slug' },
      }),
      CID,
    );
    expect(dup.status).toBe(409);
    expect(dup.code).toBe('Catalog:Duplicate');
    expect(dup.field).toBe('slug');

    expect(
      toProblemDetails(abp(409, { data: { field: `a b ${HOST}` } }), CID).field,
    ).toBeUndefined();
    expect(
      toProblemDetails(abp(422, { data: { field: 'slug' } }), CID).field,
    ).toBeUndefined();
  });

  it('422 Brand còn CarModel Published: giữ items {name, slug}, bỏ phần tử thiếu hoặc rò rỉ', () => {
    const problem = toProblemDetails(
      abp(422, {
        code: 'Catalog:BrandHasPublishedCarModels',
        data: {
          items: [
            { name: 'Vios', slug: 'vios' },
            { name: 'Camry' },
            { name: STACK, slug: 'x' },
            'not-a-record',
          ],
        },
      }),
      CID,
    );
    expect(problem.code).toBe('Catalog:BrandHasPublishedCarModels');
    expect(problem.items).toEqual([{ name: 'Vios', slug: 'vios' }]);
    expect(
      toProblemDetails(abp(422, { data: { items: [] } }), CID).items,
    ).toBeUndefined();
  });
});
