import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    env: {
      NODE_ENV: 'test',
      DB_PATH: ':memory:',
      JWT_SECRET: 'test-only-jwt-secret-0123456789abcdef0123456789abcdef',
      DEEPSEEK_API_KEY: 'test-key',
      OWNER_PASSWORD: 'owner123',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts', '!src/**/*.d.ts', '!src/**/index.ts'],
      exclude: ['src/db/migrations/**'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
    testTimeout: 10000,
  },
});
