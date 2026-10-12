import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    reporters: ['default'],
    // `npm run test:coverage` — the extension UI and browser glue are covered by the Playwright suites instead.
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/api/src/**/*.ts'],
      exclude: ['**/*.d.ts', 'apps/api/src/cli.ts', 'apps/api/src/main.ts'],
      reporter: ['text-summary', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      // CI fails below these; raise them as coverage grows, never lower them to make a build pass.
      thresholds: { lines: 85, functions: 80, branches: 68, statements: 80 },
    },
  },
});
