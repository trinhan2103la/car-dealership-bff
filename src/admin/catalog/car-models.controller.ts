import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRequest, RequirePermission } from '../../auth/jwt-auth.guard.js';
import { ParseGuidPipe } from '../../common/parse-guid.pipe.js';
import { unwrap } from '../../core-api/core-api.client.js';
import { BEARER_SECURITY } from '../../docs/swagger.js';
import { CatalogProxy, pick, toTransitionBody } from './catalog-proxy.js';

const LIST_QUERY = [
  'brandId',
  'status',
  'keyword',
  'page',
  'pageSize',
] as const;

/**
 * Proxy quản trị CarModel → Core_API `/api/catalog/car-models`. Xem trước (Req 10.9) dùng `GET :id` vì đã trả đủ
 * variant và ảnh; endpoint `preview` riêng để P5.
 */
@ApiTags('Admin catalog')
@ApiBearerAuth(BEARER_SECURITY)
@Controller('api/admin/car-models')
export class AdminCarModelsController {
  constructor(private readonly proxy: CatalogProxy) {}

  @Get()
  @RequirePermission('Catalog.Edit')
  async list(
    @Req() req: AdminRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return unwrap(
      await this.proxy.for(req).GET('/api/catalog/car-models', {
        params: { query: pick(query, LIST_QUERY) as never },
      }),
    );
  }

  @Get(':id')
  @RequirePermission('Catalog.Edit')
  async get(
    @Req() req: AdminRequest,
    @Param('id', new ParseGuidPipe()) id: string,
  ) {
    return unwrap(
      await this.proxy.for(req).GET('/api/catalog/car-models/{id}', {
        params: { path: { id } },
      }),
    );
  }

  @Get(':id/publish-check')
  @RequirePermission('Catalog.Edit')
  async publishCheck(
    @Req() req: AdminRequest,
    @Param('id', new ParseGuidPipe()) id: string,
  ) {
    return unwrap(
      await this.proxy
        .for(req)
        .GET('/api/catalog/car-models/{id}/publish-check', {
          params: { path: { id } },
        }),
    );
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('Catalog.Edit')
  async create(@Req() req: AdminRequest, @Body() body: unknown) {
    return unwrap(
      await this.proxy
        .for(req)
        .POST('/api/catalog/car-models', { body: body as never }),
    );
  }

  @Put(':id')
  @RequirePermission('Catalog.Edit')
  async update(
    @Req() req: AdminRequest,
    @Param('id', new ParseGuidPipe()) id: string,
    @Body() body: unknown,
  ) {
    return unwrap(
      await this.proxy.for(req).PUT('/api/catalog/car-models/{id}', {
        params: { path: { id } },
        body: body as never,
      }),
    );
  }

  /** `{to, concurrencyStamp}` → Core `{status, concurrencyStamp}` (lệch C). */
  @Post(':id/transitions')
  @HttpCode(200)
  @RequirePermission('Catalog.Publish')
  async transition(
    @Req() req: AdminRequest,
    @Param('id', new ParseGuidPipe()) id: string,
    @Body() body: unknown,
  ) {
    const coreBody = toTransitionBody(body);
    return unwrap(
      await this.proxy
        .for(req)
        .POST('/api/catalog/car-models/{id}/transitions', {
          params: { path: { id } },
          body: coreBody as never,
        }),
    );
  }
}
