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
import { CatalogProxy, pick } from './catalog-proxy.js';

const LIST_QUERY = ['keyword', 'status', 'page', 'pageSize'] as const;

/** Proxy quản trị Brand → Core_API `/api/catalog/brands`. Giữ nguyên status và body của Core. */
@ApiTags('Admin catalog')
@ApiBearerAuth(BEARER_SECURITY)
@Controller('api/admin/brands')
export class AdminBrandsController {
  constructor(private readonly proxy: CatalogProxy) {}

  @Get()
  @RequirePermission('Catalog.Edit')
  async list(
    @Req() req: AdminRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return unwrap(
      await this.proxy.for(req).GET('/api/catalog/brands', {
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
      await this.proxy.for(req).GET('/api/catalog/brands/{id}', {
        params: { path: { id } },
      }),
    );
  }

  @Post()
  @HttpCode(200) // giữ nguyên status của Core_API
  @RequirePermission('Catalog.Edit')
  async create(@Req() req: AdminRequest, @Body() body: unknown) {
    return unwrap(
      await this.proxy
        .for(req)
        .POST('/api/catalog/brands', { body: body as never }),
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
      await this.proxy.for(req).PUT('/api/catalog/brands/{id}', {
        params: { path: { id } },
        body: body as never,
      }),
    );
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermission('Catalog.Edit')
  async status(
    @Req() req: AdminRequest,
    @Param('id', new ParseGuidPipe()) id: string,
    @Body() body: unknown,
  ) {
    return unwrap(
      await this.proxy.for(req).POST('/api/catalog/brands/{id}/status', {
        params: { path: { id } },
        body: body as never,
      }),
    );
  }
}
