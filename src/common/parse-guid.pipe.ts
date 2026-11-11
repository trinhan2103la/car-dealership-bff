import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';

/** GUID dạng 8-4-4-4-12 hex (định dạng `Guid` của .NET), KHÔNG kiểm version/variant. */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Kiểm id do Core_API sinh. Không dùng `ParseUUIDPipe` của Nest: nó đòi UUID chuẩn RFC (nibble version 1–8, variant
 * 8–b), mà `IGuidGenerator` tuần tự của ABP sinh GUID có hai nibble đó tùy ý, nên khoảng một nửa id thật bị 400
 * (phát hiện khi kiểm đầu-cuối Ngày 94). Sai định dạng → 400 dạng ABP để mapper trả `errors.{tên tham số}`.
 */
@Injectable()
export class ParseGuidPipe implements PipeTransform<unknown, string> {
  transform(value: unknown, metadata: ArgumentMetadata): string {
    if (typeof value === 'string' && GUID.test(value)) return value.toLowerCase();
    const field = metadata.data ?? 'id';
    throw new BadRequestException({
      code: 'Validation',
      validationErrors: [{ message: 'Định danh không hợp lệ.', members: [field] }],
    });
  }
}
