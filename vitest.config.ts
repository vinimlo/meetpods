import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['dist/**', 'node_modules/**', '.worktrees/**'],
    coverage: {
      provider: 'v8',
      include: ['src/main/**/*.ts', 'src/extension/**/*.ts'],
      exclude: ['**/__tests__/**', 'src/native/**'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 95,
        statements: 99,
      },
    },
  },
});
