import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  PayloadTooLargeException,
  Post,
  Put,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AdminRequest, RequirePermission } from '../../auth/jwt-auth.guard.js';
import { ParseGuidPipe } from '../../common/parse-guid.pipe.js';
import { CoreApiClient, unwrap } from '../../core-api/core-api.client.js';
import { BEARER_SECURITY } from '../../docs/swagger.js';
import { CatalogProxy } from '../catalog/catalog-proxy.js';
import {
  ImageProcessor,
  ImageRejectedError,
  MAX_UPLOAD_BYTES,
} from './image-processor.js';

const REASON_MESSAGES: Record<string, string> = {
  Empty: 'File rỗng.',
  TooLarge: 'File vượt 5 MB.',
  UnsupportedFormat: 'Chỉ nhận JPEG, PNG hoặc WebP.',
  DimensionsTooLarge: 'Ảnh vượt 10.000 px mỗi chiều.',
  Corrupt: 'Không đọc được ảnh.',
};

@ApiTags('Admin catalog')
@ApiBearerAuth(BEARER_SECURITY)
@Controller('api/admin/car-models/:carModelId/images')
export class AdminImagesController {
  constructor(
    private readonly core: CoreApiClient,
    private readonly processor: ImageProcessor,
    private readonly proxy: CatalogProxy,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @RequirePermission('Catalog.Edit')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 },
    }),
  )
  async upload(
    @Param('carModelId', new ParseGuidPipe()) carModelId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { alt?: string; carVariantId?: string },
    @Req() req: AdminRequest,
  ) {
    if (!file) throw invalid('file', 'Thiếu file.');

    let variants;

    try {
      variants = await this.processor.process(file.buffer);
    } catch (e) {
      if (e instanceof ImageRejectedError) {
        if (e.reason === 'TooLarge')
          throw new PayloadTooLargeException({
            code: 'Validation',
            title: REASON_MESSAGES.TooLarge,
          });
        throw invalid('file', REASON_MESSAGES[e.reason]);
      }
      throw e;
    }

    const form = new FormData();

    for (const v of variants)
      form.append(
        v.name,
        // Buffer của Node có thể nằm trên SharedArrayBuffer, Blob chỉ nhận ArrayBuffer: copy sang Uint8Array.
        new Blob([new Uint8Array(v.buffer)], { type: 'image/webp' }),
        `${v.name}.webp`,
      );
    if (body.alt) form.append('alt', body.alt);
    if (body.carVariantId) form.append('carVariantId', body.carVariantId);

    const admin = req.admin!;
    const result = await this.core
      .for({
        correlationId: req.correlationId ?? 'unknown',
        admin: { userId: admin.userId, sessionId: admin.sessionId },
      })
      .POST('/api/catalog/car-models/{carModelId}/images', {
        params: { path: { carModelId } },
        body: {} as never,
        bodySerializer: () => form,
      });

    return unwrap(result);
  }

  /** Đặt lại thứ tự (đủ mọi ảnh) và tùy chọn đổi cover: `{imageIds: [...], coverImageId?}`. */
  @Put('order')
  @RequirePermission('Catalog.Edit')
  async reorder(
    @Param('carModelId', new ParseGuidPipe()) carModelId: string,
    @Body() body: unknown,
    @Req() req: AdminRequest,
  ) {
    return unwrap(
      await this.proxy
        .for(req)
        .PUT('/api/catalog/car-models/{carModelId}/images/order', {
          params: { path: { carModelId } },
          body: body as never,
        }),
    );
  }

  /** Sửa alt: `{alt}`. */
  @Put(':imageId')
  @RequirePermission('Catalog.Edit')
  async update(
    @Param('carModelId', new ParseGuidPipe()) carModelId: string,
    @Param('imageId', new ParseGuidPipe()) imageId: string,
    @Body() body: unknown,
    @Req() req: AdminRequest,
  ) {
    return unwrap(
      await this.proxy
        .for(req)
        .PUT('/api/catalog/car-models/{carModelId}/images/{imageId}', {
          params: { path: { carModelId, imageId } },
          body: body as never,
        }),
    );
  }

  /** Xóa ảnh. Core xóa object sau khi commit; storage lỗi thì Core tự thử lại bằng job. */
  @Delete(':imageId')
  @HttpCode(204)
  @RequirePermission('Catalog.Edit')
  async remove(
    @Param('carModelId', new ParseGuidPipe()) carModelId: string,
    @Param('imageId', new ParseGuidPipe()) imageId: string,
    @Req() req: AdminRequest,
  ): Promise<void> {
    unwrap(
      await this.proxy
        .for(req)
        .DELETE('/api/catalog/car-models/{carModelId}/images/{imageId}', {
          params: { path: { carModelId, imageId } },
        }),
    );
  }
}

function invalid(field: string, message: string) {
  return new BadRequestException({
    code: 'Validation',
    validationErrors: [{ message, members: [field] }],
  });
}
