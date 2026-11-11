import type { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeCore, FakeReply, RecordedRequest } from './support/fake-core.js';
import {
  createTestApp,
  sessionHandler,
  SESSION_ID,
  USER_ID,
} from './support/app.js';

// GUID tuần tự kiểu ABP (nibble version 'e', variant '6'): KHÔNG phải UUID chuẩn RFC. ParseUUIDPipe của Nest từ chối
// id dạng này; BFF dùng ParseGuidPipe nên phải nhận (lỗi thật phát hiện khi kiểm đầu-cuối Ngày 94).
const MODEL_ID = '3a24dae8-7470-e39f-668f-b851ada88e32';
const UPLOAD_URL = `/api/admin/car-models/${MODEL_ID}/images`;
const CORE_UPLOAD = `/api/catalog/car-models/${MODEL_ID}/images`;

const IMAGE_DTO = {
  id: '55555555-5555-5555-5555-555555555555',
  storageKey: 'a'.repeat(32),
  displayOrder: 0,
  isCover: false,
  alt: 'Ảnh mặt trước xe',
};

/** Tách body multipart (byte gốc) thành { tên trường → nội dung }. */
function parseMultipart(req: RecordedRequest): Record<string, Buffer> {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(
    String(req.headers['content-type']),
  );
  if (!boundary) throw new Error('không phải multipart');
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const parts: Record<string, Buffer> = {};
  let start = req.raw.indexOf(delimiter);
  while (start !== -1) {
    const next = req.raw.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const part = req.raw.subarray(start + delimiter.length + 2, next - 2); // bỏ CRLF đầu/cuối
    const headerEnd = part.indexOf('\r\n\r\n');
    const name = /name="([^"]+)"/.exec(
      part.subarray(0, headerEnd).toString('utf8'),
    )?.[1];
    if (name) parts[name] = part.subarray(headerEnd + 4);
    start = next;
  }
  return parts;
}

/** Payload của Service JWT (BFF ký) trong header Authorization gửi sang Core_API. */
function serviceClaims(req: RecordedRequest): Record<string, unknown> {
  const token = String(req.headers.authorization).replace(/^Bearer /, '');
  return JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
}

describe('Admin image upload (e2e)', () => {
  const core = new FakeCore();
  let app: NestExpressApplication;
  let editorToken: string;
  let noPermToken: string;
  let jpeg: Buffer;
  let coreReply: FakeReply;

  const login = async (permissions: string[]) => {
    core.handler = sessionHandler({ permissions });
    const res = await request(app.getHttpServer())
      .post('/api/admin/auth/login')
      .send({ email: 'admin@example.com', password: 'correct-horse-battery' });
    return res.body.accessToken as string;
  };

  beforeAll(async () => {
    await core.start();
    app = await createTestApp(core);
    editorToken = await login(['Catalog.Edit']);
    noPermToken = await login([]);
    jpeg = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: '#c03030' },
    })
      .jpeg()
      .toBuffer();

    const session = sessionHandler({ permissions: ['Catalog.Edit'] });
    core.handler = (req) =>
      req.url.startsWith('/api/catalog/') ? coreReply : session(req);
  });
  afterAll(async () => {
    await app.close();
    await core.stop();
  });
  beforeEach(() => {
    core.requests.length = 0;
    coreReply = { status: 200, body: IMAGE_DTO };
  });

  const catalogRequests = () =>
    core.requests.filter((r) => r.url.startsWith('/api/catalog/'));

  it('không có token → 401, không gọi Core_API', async () => {
    const res = await request(app.getHttpServer())
      .post(UPLOAD_URL)
      .attach('file', jpeg, 'xe.jpg');
    expect(res.status).toBe(401);
    expect(core.requests).toHaveLength(0);
  });

  it('thiếu Catalog.Edit → 403, không gọi Core_API', async () => {
    const res = await request(app.getHttpServer())
      .post(UPLOAD_URL)
      .set('Authorization', `Bearer ${noPermToken}`)
      .attach('file', jpeg, 'xe.jpg');
    expect(res.status).toBe(403);
    expect(core.requests).toHaveLength(0);
  });

  it('PDF đổi đuôi .jpg → 400 errors.file, không gọi Core_API', async () => {
    const pdf = Buffer.from(
      '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n',
    );
    const res = await request(app.getHttpServer())
      .post(UPLOAD_URL)
      .set('Authorization', `Bearer ${editorToken}`)
      .attach('file', pdf, { filename: 'xe.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(res.body.errors?.file).toBeDefined();
    expect(catalogRequests()).toHaveLength(0);
  });

  it('thiếu file → 400 errors.file', async () => {
    const res = await request(app.getHttpServer())
      .post(UPLOAD_URL)
      .set('Authorization', `Bearer ${editorToken}`)
      .field('alt', 'Ảnh mặt trước xe');
    expect(res.status).toBe(400);
    expect(res.body.errors?.file).toBeDefined();
    expect(catalogRequests()).toHaveLength(0);
  });

  it('JPEG hợp lệ → Core nhận 1 multipart có sm/md/lg là WebP, kèm alt và sub/sid', async () => {
    const res = await request(app.getHttpServer())
      .post(UPLOAD_URL)
      .set('Authorization', `Bearer ${editorToken}`)
      .field('alt', 'Ảnh mặt trước xe')
      .attach('file', jpeg, 'xe.jpg');

    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: IMAGE_DTO,
    });

    const sent = catalogRequests();
    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe('POST');
    expect(sent[0].url).toBe(CORE_UPLOAD);
    expect(String(sent[0].headers['content-type'])).toContain(
      'multipart/form-data',
    );

    const parts = parseMultipart(sent[0]);
    for (const size of ['sm', 'md', 'lg']) {
      const bytes = parts[size];
      expect(bytes, size).toBeDefined();
      expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
      expect(bytes.toString('ascii', 8, 12)).toBe('WEBP');
    }
    expect(parts.alt.toString('utf8')).toBe('Ảnh mặt trước xe');

    const claims = serviceClaims(sent[0]);
    expect(claims.sub).toBe(USER_ID);
    expect(claims.sid).toBe(SESSION_ID);
  });

  it('Core trả 503 không có body → BFF trả 503 ProblemDetails CoreUnavailable', async () => {
    coreReply = { status: 503 };
    const res = await request(app.getHttpServer())
      .post(UPLOAD_URL)
      .set('Authorization', `Bearer ${editorToken}`)
      .attach('file', jpeg, 'xe.jpg');
    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.code).toBe('CoreUnavailable');
  });

  it('Core trả 503 Catalog:StorageUnavailable → BFF giữ 503 và mã lỗi ổn định của Core', async () => {
    coreReply = {
      status: 503,
      body: {
        error: {
          code: 'Catalog:StorageUnavailable',
          message: 'Lưu ảnh tạm thời không khả dụng, hãy thử lại.',
        },
      },
    };
    const res = await request(app.getHttpServer())
      .post(UPLOAD_URL)
      .set('Authorization', `Bearer ${editorToken}`)
      .attach('file', jpeg, 'xe.jpg');
    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.code).toBe('Catalog:StorageUnavailable');
  });

  it('Core trả 422 (đủ 30 ảnh) → BFF giữ nguyên 422 và mã lỗi', async () => {
    coreReply = {
      status: 422,
      body: {
        error: {
          code: 'Catalog:ImageLimitReached',
          message: 'Đã đủ 30 ảnh.',
        },
      },
    };
    const res = await request(app.getHttpServer())
      .post(UPLOAD_URL)
      .set('Authorization', `Bearer ${editorToken}`)
      .attach('file', jpeg, 'xe.jpg');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('Catalog:ImageLimitReached');
  });

  it('carModelId không phải UUID → 400, không gọi Core_API', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/car-models/not-a-uuid/images')
      .set('Authorization', `Bearer ${editorToken}`)
      .attach('file', jpeg, 'xe.jpg');
    expect(res.status).toBe(400);
    expect(catalogRequests()).toHaveLength(0);
  });
});
