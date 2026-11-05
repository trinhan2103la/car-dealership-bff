import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { CorrelationIdMiddleware } from './common/correlation-id.middleware.js';
import { buildLoggerParams } from './common/logger.config.js';
import { AuthModule } from './auth/auth.module.js';
import { CoreApiModule } from './core-api/core-api.module.js';
import { ErrorsModule } from './errors/errors.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    // Test (Vitest đặt VITEST=true) không đọc .env của máy dev, để kết quả không phụ thuộc cấu hình local.
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.VITEST === 'true',
    }),
    LoggerModule.forRoot(buildLoggerParams()),
    HealthModule,
    ErrorsModule,
    CoreApiModule,
    // Auth bằng access token (Bearer) + refresh token (cookie HttpOnly). Không còn CSRF token toàn cục.
    AuthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Correlation_Id áp cho mọi route, chạy trước khi pino-http gán reqId.
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
