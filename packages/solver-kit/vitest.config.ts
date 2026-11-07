import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      // Map .js imports to .ts source files for vitest
    },
  },
  esbuild: {
    target: 'node18',
  },
});
