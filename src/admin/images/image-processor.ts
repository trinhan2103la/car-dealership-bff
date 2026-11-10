import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import type { Metadata } from 'sharp';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB
export const MAX_DIMENSION = 10_000; // 10,000 pixels
export const VARIANT_SIZES = { sm: 480, md: 960, lg: 1600 } as const;
export type VariantName = keyof typeof VARIANT_SIZES;

export type DetectedFormat = 'jpeg' | 'png' | 'webp';
export type ImageRejectReason =
  | 'Empty'
  | 'TooLarge'
  | 'UnsupportedFormat'
  | 'DimensionsTooLarge'
  | 'Corrupt';

export class ImageRejectedError extends Error {
  constructor(readonly reason: ImageRejectReason) {
    super(`Ảnh bị từ chối: ${reason}`);
    this.name = 'ImageRejectedError';
  }
}

export interface ProcessedVariant {
  name: VariantName;
  width: number;
  height: number;
  buffer: Buffer;
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export function detectFormat(buffer: Buffer): DetectedFormat | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'jpeg';
  }

  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE))
    return 'png';

  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'webp';
  return null;
}

const SHARP_INPUT = {
  limitInputPixels: MAX_DIMENSION * MAX_DIMENSION,
  failOn: 'error' as const,
};

@Injectable()
export class ImageProcessor {
  async process(input: Buffer): Promise<ProcessedVariant[]> {
    const inputLength = input.length;

    if (inputLength === 0) throw new ImageRejectedError('Empty');

    if (inputLength > MAX_UPLOAD_BYTES)
      throw new ImageRejectedError('TooLarge');

    const format = detectFormat(input);

    if (!format) throw new ImageRejectedError('UnsupportedFormat');

    let meta: Metadata;

    try {
      meta = await sharp(input, SHARP_INPUT).metadata();
    } catch  {
      throw new ImageRejectedError('Corrupt');
    }

    if (meta.format !== format)
      throw new ImageRejectedError('UnsupportedFormat');
    if (!meta.width || !meta.height) throw new ImageRejectedError('Corrupt');
    if (meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION)
      throw new ImageRejectedError('DimensionsTooLarge');

    try {
      const response = await Promise.all(
        (Object.entries(VARIANT_SIZES) as [VariantName, number][]).map(
          async ([name, edge]) => {
            const { data, info } = await sharp(input, SHARP_INPUT)
              // Xoay theo EXIF Orientation TRƯỚC khi metadata bị bỏ, nếu không ảnh chụp dọc sẽ bị nằm ngang.
              .rotate()
              .resize({
                width: edge,
                height: edge,
                fit: 'inside',
                withoutEnlargement: true,
              })
              // KHÔNG gọi withMetadata()/keepExif(): mặc định sharp bỏ toàn bộ EXIF (kể cả GPS).
              .webp({ quality: 80 })
              .toBuffer({ resolveWithObject: true });
            return {
              name,
              width: info.width,
              height: info.height,
              buffer: data,
            };
          },
        ),
      );
      return response;
    } catch {
      throw new ImageRejectedError('Corrupt');
    }
  }
}
