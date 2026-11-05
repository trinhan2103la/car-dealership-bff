import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { CoreApiModule } from '../core-api/core-api.module.js';
import { AccessTokenService } from './access-token.service.js';
import { AuthController } from './auth.controller.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { OriginGuard } from './origin.guard.js';
import { RefreshCookie } from './refresh-cookie.js';
import { SessionService } from './session.service.js';

import {
  LOGIN_RATE_LIMIT_DEFAULT,
  LOGIN_THROTTLER,
  RATE_WINDOW_MS_DEFAULT,
  REFRESH_RATE_LIMIT_DEFAULT,
  REFRESH_THROTTLER,
} from './auth.constants.js';

@Module({
  imports: [
    CoreApiModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: LOGIN_THROTTLER,
          limit:
            Number(config.get('AUTH_LOGIN_RATE_LIMIT')) ||
            LOGIN_RATE_LIMIT_DEFAULT,
          ttl:
            Number(config.get('AUTH_LOGIN_RATE_WINDOW_MS')) ||
            RATE_WINDOW_MS_DEFAULT,
        },
        {
          name: REFRESH_THROTTLER,
          limit:
            Number(config.get('AUTH_REFRESH_RATE_LIMIT')) ||
            REFRESH_RATE_LIMIT_DEFAULT,
          ttl: RATE_WINDOW_MS_DEFAULT,
        },
      ],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AccessTokenService,
    RefreshCookie,
    SessionService,
    OriginGuard,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AccessTokenService],
})
export class AuthModule {}
