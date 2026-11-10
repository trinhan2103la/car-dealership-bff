import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  ImageProcessor,
  ImageRejectedError,
  MAX_UPLOAD_BYTES,
  detectFormat,
} from './image-processor.js';

const solid = (width: number, height: number) =>
  sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 30, b: 30 },
    },
  });

const processor = new ImageProcessor();

async function rejected(input: Buffer) {
  try {
    await processor.process(input);
  } catch (e) {
    if (e instanceof ImageRejectedError) return e.reason;
    throw e;
  }
  throw new Error('expected rejection');
}

describe('ImageProcessor', () => {
  it('JPEG hợp lệ → 3 WebP, cạnh dài đúng, không phóng to', async () => {
    const out = await processor.process(
      await solid(3000, 2000).jpeg().toBuffer(),
    );

    expect(out.map((v) => v.name)).toEqual(['sm', 'md', 'lg']);
    expect(out.map((v) => Math.max(v.width, v.height))).toEqual([
      480, 960, 1600,
    ]);
    for (const v of out) expect(detectFormat(v.buffer)).toBe('webp');
  });

  it('ảnh nhỏ hơn biến thể thì giữ nguyên kích thước', async () => {
    const out = await processor.process(await solid(300, 200).png().toBuffer());
    expect(out.every((v) => v.width === 300 && v.height === 200)).toBe(true);
  });

  it('EXIF bị loại khỏi output', async () => {
    const withExif = await solid(800, 600)
      .jpeg()
      .withExif({ IFD0: { Copyright: 'cdp-test-gps-should-vanish' } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined(); // tiền điều kiện: input CÓ exif

    for (const v of await processor.process(withExif)) {
      expect((await sharp(v.buffer).metadata()).exif).toBeUndefined();
    }
  });

  it('file PDF đổi đuôi .jpg bị từ chối theo chữ ký', async () => {
    const fakePdf = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj <<>> endobj\n');
    expect(await rejected(fakePdf)).toBe('UnsupportedFormat');
  });

  it('chữ ký JPEG nhưng phần sau là rác → Corrupt hoặc UnsupportedFormat', async () => {
    const forged = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.alloc(100, 1),
    ]);
    expect(['Corrupt', 'UnsupportedFormat']).toContain(await rejected(forged));
  });

  it('0 byte → Empty; 5.242.881 byte → TooLarge (kiểm trước khi giải mã)', async () => {
    expect(await rejected(Buffer.alloc(0))).toBe('Empty');
    const big = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    expect(await rejected(big)).toBe('TooLarge');
  });

  it('10.000 px được nhận, 10.001 px bị từ chối', async () => {
    await expect(
      processor.process(await solid(10_000, 10).png().toBuffer()),
    ).resolves.toHaveLength(3);
    expect(await rejected(await solid(10_001, 10).png().toBuffer())).toBe(
      'DimensionsTooLarge',
    );
  });
});
