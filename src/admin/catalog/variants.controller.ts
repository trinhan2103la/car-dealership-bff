import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRequest, RequirePermission } from '../../auth/jwt-auth.guard.js';
import { ParseGuidPipe } from '../../common/parse-guid.pipe.js';
import { unwrap } from '../../core-api/core-api.client.js';
import { BEARER_SECURITY } from '../../docs/swagger.js';
import { CatalogProxy, toTransitionBody } from './catalog-proxy.js';

/** Proxy CarVariant (lồng dưới CarModel, lệch B) → Core_API `/api/catalog/car-models/{carModelId}/variants`. */
@ApiTags('Admin catalog')
@ApiBearerAuth(BEARER_SECURITY)
@Controller('api/admin/car-models/:carModelId/variants')
export class AdminVariantsController {
  constructor(private readonly proxy: CatalogProxy) {}

  @Get()
  @RequirePermission('Catalog.Edit')
  async list(
    @Req() req: AdminRequest,
    @Param('carModelId', new ParseGuidPipe()) carModelId: string,
  ) {
    return unwrap(
      await this.proxy
        .for(req)
        .GET('/api/catalog/car-models/{carModelId}/variants', {
          params: { path: { carModelId } },
        }),
    );
  }

  @Get(':variantId')
  @RequirePermission('Catalog.Edit')
  async get(
    @Req() req: AdminRequest,
    @Param('carModelId', new ParseGuidPipe()) carModelId: string,
    @Param('variantId', new ParseGuidPipe()) variantId: string,
  ) {
    return unwrap(
      await this.proxy
        .for(req)
        .GET('/api/catalog/car-models/{carModelId}/variants/{variantId}', {
          params: { path: { carModelId, variantId } },
        }),
    );
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('Catalog.Edit')
  async create(
    @Req() req: AdminRequest,
    @Param('carModelId', new ParseGuidPipe()) carModelId: string,
    @Body() body: unknown,
  ) {
    return unwrap(
      await this.proxy
        .for(req)
        .POST('/api/catalog/car-models/{carModelId}/variants', {
          params: { path: { carModelId } },
          body: body as never,
        }),
    );
  }

  @Put(':variantId')
  @RequirePermission('Catalog.Edit')
  async update(
    @Req() req: AdminRequest,
    @Param('carModelId', new ParseGuidPipe()) carModelId: string,
    @Param('variantId', new ParseGuidPipe()) variantId: string,
    @Body() body: unknown,
  ) {
    return unwrap(
      await this.proxy
        .for(req)
        .PUT('/api/catalog/car-models/{carModelId}/variants/{variantId}', {
          params: { path: { carModelId, variantId } },
          body: body as never,
        }),
    );
  }

  /** `{to, concurrencyStamp}` → Core `{status, concurrencyStamp}` (lệch C). */
  @Post(':variantId/transitions')
  @HttpCode(200)
  @RequirePermission('Catalog.Publish')
  async transition(
    @Req() req: AdminRequest,
    @Param('carModelId', new ParseGuidPipe()) carModelId: string,
    @Param('variantId', new ParseGuidPipe()) variantId: string,
    @Body() body: unknown,
  ) {
    const coreBody = toTransitionBody(body);
    return unwrap(
      await this.proxy
        .for(req)
        .POST(
          '/api/catalog/car-models/{carModelId}/variants/{variantId}/transitions',
          {
            params: { path: { carModelId, variantId } },
            body: coreBody as never,
          },
        ),
    );
  }
}
