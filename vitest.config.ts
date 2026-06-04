import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{js,ts,tsx}'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.{ts,tsx}', 'electron/**/*.js'],
      exclude: [
        '**/*.test.*',
        'src/**/*.d.ts',
        'src/assets/**',
        'src/**/*.css',
        'build/**',
        'coverage/**',
        'dist/**',
        'node_modules/**',
        'release/**',
        'scripts/**',
        'testspace/**',
      ],
    },
  },
});
