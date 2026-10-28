import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Ngày 17: unit test (*.spec.ts trong src). NestJS 12 là ESM-only; dùng vitest + swc
// để transform decorator metadata (emitDecoratorMetadata) mà ts-jest CJS không làm được.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    root: './',
  },
  plugins: [
    // swc đọc .swcrc để bật legacyDecorator + decoratorMetadata.
    swc.vite(),
  ],
});
