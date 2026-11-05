import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const SWAGGER_PATH = 'docs';
export const BEARER_SECURITY = 'access-token';

/**
 * Swagger UI chỉ bật khi KHÔNG phải production.
 * UI ở /docs, JSON ở /docs-json. Auth bằng access token Bearer; refresh token là cookie HttpOnly mà trình duyệt
 * tự gửi (cùng origin), Swagger không cần và không đọc được.
 */
export function swaggerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production';
}

export function buildOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Car Dealership BFF')
    .setDescription(
      [
        'API của BFF mà Admin Portal và Public Web gọi (cùng origin qua `/api/*`).',
        '',
        'Gọi thử request cần đăng nhập:',
        '1. `POST /api/admin/auth/login` → chép `accessToken` (cookie refresh token được trình duyệt tự lưu).',
        '2. Bấm **Authorize**, dán `accessToken` vào ô `access-token` (không cần chữ "Bearer").',
        '3. Token sống 10 phút; hết hạn thì gọi `POST /api/admin/auth/refresh` để lấy token mới.',
        '',
        'Mọi lỗi trả về dạng ProblemDetails (RFC 9457), `Content-Type: application/problem+json`.',
      ].join('\n'),
    )
    .setVersion('v1')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token ES256, 10 phút.',
      },
      BEARER_SECURITY,
    )
    .build();

  return SwaggerModule.createDocument(app, config);
}

export function setupSwagger(app: INestApplication): void {
  if (!swaggerEnabled()) return;
  SwaggerModule.setup(SWAGGER_PATH, app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: `${SWAGGER_PATH}-json`,
    swaggerOptions: {
      // Gửi kèm cookie refresh token khi "Try it out" /refresh, /logout (cùng origin nên an toàn).
      withCredentials: true,
      persistAuthorization: true,
      displayRequestDuration: true,
    },
  });
}
