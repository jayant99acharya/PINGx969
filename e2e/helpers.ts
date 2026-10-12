import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type APIRequestContext, type BrowserContext, type Frame, type Page, chromium, expect, request } from '@playwright/test';

export const API = 'http://127.0.0.1:4310'; // dedicated test port (doesn't clash with a running dev/prod server)
export const SITE = 'http://127.0.0.1:4100';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const fixture = (p: string) => path.join(root, 'fixtures', p);

export function tempProfileDir(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `px-e2e-${name}-`));
}

/** Launch Chromium with the built extension loaded (works headless with the new headless mode). */
export async function launchWithExtension(userDataDir: string): Promise<{ context: BrowserContext; extensionId: string }> {
  const ext = path.join(root, 'apps/extension/dist');
  if (!fs.existsSync(path.join(ext, 'manifest.json'))) throw new Error('Build the extension first: npm run build -w @pingx969/extension');
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: !process.env.HEADED,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    acceptDownloads: true,
    viewport: { width: 1360, height: 900 },
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  const extensionId = sw.url().split('/')[2];
  return { context, extensionId };
}

export async function signInExtension(context: BrowserContext, extensionId: string, email: string, password: string) {
  const page = await context.newPage();
  const url = `chrome-extension://${extensionId}/options.html`;
  // On first install the extension opens its options page itself, which can interrupt this navigation.
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(url);
      break;
    } catch (e) {
      if (attempt >= 4) throw e;
      await page.waitForTimeout(400);
    }
  }
  await page.getByLabel('Server URL').fill(API);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Signed in as')).toBeVisible();
  await page.close();
}

/** Click the in-page launcher and return the review panel frame (an extension-origin iframe). */
export async function openPanel(page: Page | Frame): Promise<Frame> {
  const launcher = page.locator('[data-px-ui="launcher"] button.go');
  await expect(launcher).toBeVisible({ timeout: 20_000 });
  await launcher.click();
  const iframe = page.locator('iframe[data-px-ui="panel"]');
  await expect(iframe).toBeVisible();
  const handle = await iframe.elementHandle();
  const frame = await handle!.contentFrame();
  if (!frame) throw new Error('panel frame not found');
  await expect(frame.getByText(/fields detected/)).toBeVisible({ timeout: 20_000 });
  return frame;
}

/** A field row in the panel, matched by its own label (not by the type-correction menu's options). */
export const row = (panel: Frame, text: string | RegExp) => panel.locator('li[data-field-id]').filter({ has: panel.locator('.head .label', { hasText: text }) });

export async function apiAs(email: string, password: string): Promise<APIRequestContext> {
  const anon = await request.newContext({ baseURL: API });
  const res = await anon.post('/api/auth/login', { data: { email, password, client: 'extension' } });
  expect(res.ok(), await res.text()).toBeTruthy();
  const { token } = await res.json();
  await anon.dispose();
  return request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
}

export async function registerViaApi(email: string, password: string, name = 'E2E User') {
  const anon = await request.newContext({ baseURL: API });
  const res = await anon.post('/api/auth/register', { data: { email, password, name } });
  expect(res.status(), await res.text()).toBe(201);
  await anon.dispose();
}
