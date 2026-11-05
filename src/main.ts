import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { setupSwagger } from './docs/swagger.js';

/**
 * Bootstrap BFF. Dùng pino (nestjs-pino) làm logger của Nest để log JSON đồng nhất,
 * bufferLogs để bắt cả log khởi động.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  // Thay logger mặc định bằng pino.
  app.useLogger(app.get(Logger));

  // Chỉ tin X-Forwarded-For từ đúng N proxy tin cậy (mặc định 0 = bỏ qua header) để IP rate limit không bị giả mạo.
  const hops = Number(process.env.TRUST_PROXY_HOPS);
  app.set('trust proxy', Number.isInteger(hops) && hops > 0 ? hops : false);

  // Swagger UI tại /docs, JSON tại /docs-json. Chỉ khi NODE_ENV !== 'production'.
  setupSwagger(app);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

void bootstrap();
