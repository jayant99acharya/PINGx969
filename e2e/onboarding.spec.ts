/**
 * What a new user sees before everything is set up: the launcher says why it can't fill yet and the
 * panel offers the way out (sign in / fix the server URL) instead of failing silently.
 */
import { type BrowserContext, type Worker, expect, test } from '@playwright/test';
import { SITE, launchWithExtension, tempProfileDir } from './helpers';

test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let worker: Worker;

test.beforeAll(async () => {
  ({ context } = await launchWithExtension(tempProfileDir('onboarding')));
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
});

test.afterAll(async () => {
  await context?.close();
});

const launcherText = (page: import('@playwright/test').Page) => page.locator('[data-px-ui="launcher"] button.go');

test('signed out: the launcher says "sign in to fill" and the panel links to sign-in', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/ats/lever.html`);
  await expect(launcherText(page)).toHaveText(/sign in to fill/, { timeout: 20_000 });
  await expect(page.locator('[data-px-ui="launcher"]')).toHaveAttribute('data-px-state', 'signin');
  await launcherText(page).click();
  const frame = await (await page.locator('iframe[data-px-ui="panel"]').elementHandle())!.contentFrame();
  await expect(frame!.getByRole('button', { name: 'Open sign-in' })).toBeVisible();
  await page.close();
});

test('server unreachable: the launcher says "server offline" and the panel links to the server setting', async () => {
  await worker.evaluate(() => chrome.storage.local.set({ apiUrl: 'http://127.0.0.1:4999', token: 'test-token' }));
  const page = await context.newPage();
  await page.goto(`${SITE}/ats/lever.html`);
  await expect(launcherText(page)).toHaveText(/server offline/, { timeout: 20_000 });
  await launcherText(page).click();
  const frame = await (await page.locator('iframe[data-px-ui="panel"]').elementHandle())!.contentFrame();
  await expect(frame!.getByText(/Can't reach the PINGx969 server at http:\/\/127\.0\.0\.1:4999/)).toBeVisible();
  await expect(frame!.getByRole('button', { name: 'Open settings (server URL)' })).toBeVisible();
  await worker.evaluate(() => chrome.storage.local.remove(['apiUrl', 'token']));
  await page.close();
});
