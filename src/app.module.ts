import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { CorrelationIdMiddleware } from './common/correlation-id.middleware.js';
import { buildLoggerParams } from './common/logger.config.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot(buildLoggerParams()),
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Correlation_Id áp cho mọi route, chạy trước khi pino-http gán reqId.
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
