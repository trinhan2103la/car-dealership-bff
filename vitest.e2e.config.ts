import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Ngày 17: e2e test (*.e2e-spec.ts trong test/) với supertest.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts'],
    root: './',
    // e2e khởi tạo Nest app -> cho timeout rộng hơn.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  plugins: [swc.vite()],
});
