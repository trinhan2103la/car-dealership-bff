import { Module } from '@nestjs/common';
import { CoreApiModule } from '../core-api/core-api.module.js';
import { CatalogProxy } from './catalog/catalog-proxy.js';
import { ImageProcessor } from './images/image-processor.js';
import { AdminImagesController } from './images/images.controller.js';

/** Endpoint quản trị (Bearer + Permission). Core_API kiểm quyền lần cuối, BFF chỉ chặn sớm. */
@Module({
  imports: [CoreApiModule],
  controllers: [AdminImagesController],
  providers: [CatalogProxy, ImageProcessor],
})
export class AdminModule {}
