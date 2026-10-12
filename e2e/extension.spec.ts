/**
 * Extension behaviour on the mock application pages: dynamic fields, prefilled fields,
 * dropdowns / radios / checkboxes / consent, the toolbar popup, and learning typed answers.
 */
import { type APIRequestContext, type BrowserContext, type Page, expect, test } from '@playwright/test';
import { SITE, apiAs, launchWithExtension, openPanel, registerViaApi, row, signInExtension, tempProfileDir } from './helpers';

test.describe.configure({ mode: 'serial' });

const email = `ext.${Date.now()}@example.com`;
const password = 'extension-pass-123';
let context: BrowserContext;
let extensionId: string;
let api: APIRequestContext;

test.beforeAll(async () => {
  await registerViaApi(email, password, 'Sam Rivera');
  api = await apiAs(email, password);
  const res = await api.patch('/api/profile', {
    data: {
      personal: { firstName: 'Sam', lastName: 'Rivera', email, phone: '+1 415 555 0100' },
      location: { address1: '500 Market St', city: 'San Francisco', state: 'CA', postalCode: '94105', country: 'United States' },
      links: { linkedin: 'https://linkedin.com/in/samr', github: 'https://github.com/samr' },
      experience: [{ company: 'Initrode', title: 'Backend Engineer', startDate: '2019-01', current: true }],
      workAuthorization: { authorizedCountries: ['United States'], requiresSponsorship: 'no' },
      preferences: { willingToRelocate: 'yes' },
    },
  });
  expect(res.ok()).toBeTruthy();
  ({ context, extensionId } = await launchWithExtension(tempProfileDir('ext')));
  await signInExtension(context, extensionId, email, password);
});

test.afterAll(async () => {
  await api?.dispose();
  await context?.close();
});

test('dynamic multi-step form: new fields are detected and filled after autofill starts', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/dynamic.html`);
  const panel = await openPanel(page);
  await expect(row(panel, 'Given name')).toHaveAttribute('data-status', 'ready');
  await panel.getByRole('button', { name: /^Fill \d+ fields?$/ }).click();
  await expect(panel.getByText(/Filled 3 fields/)).toBeVisible();
  await expect(page.locator('#fname')).toHaveValue('Sam');
  // React-style controlled input kept the value after blur
  await page.locator('#lname').focus();
  await expect(page.locator('#mail')).toHaveValue(email);
  await panel.getByRole('button', { name: 'Close', exact: true }).click();

  // Step 2 is rendered by JavaScript; the MutationObserver picks it up and fills it.
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('#tel')).toHaveValue('+1 415 555 0100');
  await expect(page.locator('#city')).toHaveValue('San Francisco');
  await expect(page.locator('#spons')).toHaveValue('No');
  // A conditional follow-up appears only for "Yes": switch and check it is detected
  await page.locator('#spons').selectOption('Yes');
  await expect(page.locator('#visa')).toBeVisible();
  await page.getByRole('button', { name: 'Add work experience' }).click();
  await expect(page.locator('#co1')).toHaveValue('Initrode');
  // A custom question without a saved answer is left empty (never guessed)
  await expect(page.locator('#why')).toHaveValue('');
  await page.close();
});

test('prefilled fields are preserved unless the user chooses to replace them', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/prefilled.html`);
  const panel = await openPanel(page);
  const first = row(panel, 'First name');
  await expect(first).toHaveAttribute('data-status', 'prefilled');
  await expect(first.getByText('Replace “Janet”')).toBeVisible();
  await expect(row(panel, 'Email')).toHaveAttribute('data-status', 'prefilled');
  await panel.getByRole('button', { name: /^Fill \d+ fields?$/ }).click();
  await expect(panel.getByText(/Filled \d+ field/)).toBeVisible();
  await expect(page.locator('#pf-first')).toHaveValue('Janet');
  await expect(page.locator('#pf-email')).toHaveValue('j.doe@hooli-account.example');
  await expect(page.locator('#pf-last')).toHaveValue('Rivera');
  await expect(page.locator('#pf-li')).toHaveValue('https://linkedin.com/in/samr');
  // Explicit replace
  await row(panel, 'First name').getByLabel(/Replace/).check();
  await panel.getByRole('button', { name: /^Fill \d+ fields?$/ }).click();
  await expect(page.locator('#pf-first')).toHaveValue('Sam');
  await page.close();
});

test('launcher and panel stay visible under ad-blocker cosmetic filters', async () => {
  const page = await context.newPage();
  // A real EasyList-style rule seen hiding the launcher in Chrome, plus rules aimed squarely at our elements.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = 'head ~ div[style*="z-index"], pingx969-ui, [data-px-ui] { display:none !important; visibility:hidden !important; opacity:0 !important; width:0 !important; height:0 !important; }';
      document.head.append(s);
    });
  });
  await page.goto(`${SITE}/greenhouse.html`);
  const panel = await openPanel(page); // asserts the launcher and the panel iframe are visible
  await expect(row(panel, 'Email')).toHaveAttribute('data-status', 'ready');
  await page.close();
});

test('dropdowns, radio buttons, checkboxes; consent boxes are never ticked', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/workday.html`);
  const panel = await openPanel(page);
  await expect(row(panel, 'I certify')).toHaveAttribute('data-status', 'manual');
  await expect(row(panel, 'willing to relocate')).toHaveAttribute('data-status', 'review'); // job-dependent → confirm
  const tech = row(panel, 'Which of these technologies');
  await expect(tech).toHaveAttribute('data-status', 'unknown');
  await tech.locator('.answer').getByLabel('Python').check();
  await tech.locator('.answer').getByLabel('AWS').check();
  await tech.getByLabel('Remember this answer').check();
  await panel.getByRole('button', { name: /^Fill \d+ fields?$/ }).click();
  await expect(panel.getByText(/Filled \d+ fields?/)).toBeVisible();
  await expect(page.locator('#wd-7')).toHaveValue('CA');
  await expect(page.locator('#wd-9')).toHaveValue('usa');
  await expect(page.locator('input[name="wd-elig"][value="1"]')).toBeChecked();
  await expect(page.locator('input[name="wd-reloc"][value="yes"]')).toBeChecked();
  await expect(page.locator('input[name="wd-tech"][value="python"]')).toBeChecked();
  await expect(page.locator('input[name="wd-tech"][value="aws"]')).toBeChecked();
  await expect(page.locator('input[name="wd-tech"][value="go"]')).not.toBeChecked();
  await expect(page.locator('#wd-certify')).not.toBeChecked();
  await expect(page.locator('#wd-yoe')).toHaveValue(/^\d+$/);
  await page.close();
});

test('toolbar popup: summary, one-click autofill and review', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/greenhouse.html`);
  await expect(page.locator('[data-px-ui="launcher"]')).toBeAttached();
  const tabId = await getTabId(page);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${tabId}`);
  await expect(popup.getByText(/✓ \d+ fields detected/)).toBeVisible();
  await expect(popup.getByText(/✓ \d+ fields can be filled/)).toBeVisible();
  await expect(popup.getByText(/fields need attention/)).toBeVisible();
  await expect(popup.locator('.field-list li.s-ready', { hasText: 'Email' })).toBeVisible();
  await popup.getByRole('button', { name: 'Autofill Application' }).click();
  await expect(popup.getByText(/Filled \d+ fields?/)).toBeVisible();
  await expect(page.locator('#first_name')).toHaveValue('Sam');
  await expect(page.locator('#question_103')).toHaveValue('1'); // work authorization from profile
  await expect(page.locator('#question_104')).toHaveValue('0'); // no sponsorship
  // Unanswered questions open the review panel instead of being guessed
  await expect(page.locator('iframe[data-px-ui="panel"]')).toBeVisible();
  await popup.close();
  await page.close();
});

test('answers typed directly into the page are learned and reused elsewhere', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/greenhouse.html`);
  await expect(page.locator('[data-px-ui="launcher"]')).toBeAttached();
  await page.locator('#question_106').fill('A friend at Globex told me about it');
  await page.locator('#question_106').blur(); // fires "change" — learned with autoLearn on
  await expect
    .poll(async () => ((await (await api.get('/api/answers')).json()).answers as { questionKey: string; answer: string }[]).find((a) => a.questionKey === 'referral_source')?.answer)
    .toBe('A friend at Globex told me about it');
  await page.close();
  const dyn = await context.newPage();
  await dyn.goto(`${SITE}/workday.html`);
  await openPanel(dyn); // still works after learning
  await dyn.close();
});

async function getTabId(page: Page): Promise<number> {
  const [sw] = context.serviceWorkers();
  const url = page.url();
  return sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)!.id!, url);
}
