import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';

/**
 * Ngày 17: bootstrap BFF. Dùng pino (nestjs-pino) làm logger của Nest để log JSON đồng nhất,
 * bufferLogs để bắt cả log khởi động.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Thay logger mặc định bằng pino.
  app.useLogger(app.get(Logger));

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

void bootstrap();
