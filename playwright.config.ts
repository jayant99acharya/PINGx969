import path from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests run against the production builds:
 *   - API + dashboard on http://127.0.0.1:4000 with a fresh embedded database per run
 *   - mock job-application site on http://127.0.0.1:4100
 *   - the real MV3 extension loaded into Playwright's Chromium
 * Run with: npm run test:e2e
 */
const dataDir = path.resolve('e2e/.data', `run-${process.env.E2E_RUN_ID ?? Date.now()}`);
process.env.E2E_RUN_ID ??= path.basename(dataDir).slice(4);

export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/report' }]],
  use: {
    baseURL: 'http://127.0.0.1:4310',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node apps/api/dist/main.js',
      url: 'http://127.0.0.1:4310/api/health',
      reuseExistingServer: false,
      timeout: 90_000,
      env: { PORT: '4310', HOST: '127.0.0.1', DATA_DIR: dataDir, NODE_ENV: 'development', LOG_REQUESTS: 'false', RATE_LIMIT_AUTH: '500', WEB_URL: '' },
    },
    {
      command: 'npx tsx scripts/mock-site.ts',
      url: 'http://127.0.0.1:4100/',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
