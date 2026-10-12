/**
 * End-to-end acceptance scenario (steps 1–16 of the spec), executed through the real
 * dashboard UI and the real Chrome extension. Step 17 (all automated tests) is `npm run test:all`.
 */
import fs from 'node:fs';
import JSZip from 'jszip';
import { type APIRequestContext, type BrowserContext, type Frame, type Page, expect, test } from '@playwright/test';
import { parseResume } from '@pingx969/resume-parser';
import { BACKEND_JD } from '../scripts/fixture-data';
import { API, SITE, apiAs, fixture, launchWithExtension, openPanel, row, signInExtension, tempProfileDir } from './helpers';

test.describe.configure({ mode: 'serial' });

const email = `jane.e2e.${Date.now()}@example.com`;
const password = 'acceptance-pass-123';
const userDataDir = tempProfileDir('acceptance');
let context: BrowserContext;
let extensionId: string;
let dash: Page;
let api: APIRequestContext;
let resumeId = '';
let versionId = '';
let originalData: unknown;

test.beforeAll(async () => {
  ({ context, extensionId } = await launchWithExtension(userDataDir));
  dash = await context.newPage();
});

test.afterAll(async () => {
  await api?.dispose();
  await context?.close();
});

test('Step 1 — create a test user', async () => {
  await dash.goto(`${API}/register`);
  await dash.getByLabel('Full name').fill('Jane Doe');
  await dash.getByLabel('Email').fill(email);
  await dash.getByLabel('Password').fill(password);
  await dash.getByRole('button', { name: 'Create account' }).click();
  await expect(dash).toHaveURL(/\/resumes/);
  api = await apiAs(email, password);
});

test('Step 2 — upload a realistic resume (DOCX)', async () => {
  await dash.locator('[data-testid="resume-file-input"]').setInputFiles(fixture('resumes/jane-doe.docx'));
  await expect(dash).toHaveURL(/\/resumes\/[0-9a-f-]{36}$/);
  resumeId = dash.url().split('/').pop()!;
});

test('Step 3 — resume is parsed correctly', async () => {
  await expect(dash.getByRole('heading', { name: 'jane-doe' })).toBeVisible();
  await expect(dash.getByText('Senior Software Engineer').first()).toBeVisible();
  await expect(dash.getByText('· Northwind Commerce')).toBeVisible();
  await expect(dash.getByText('· Contoso Health')).toBeVisible();
  const r = await (await api.get(`/api/resumes/${resumeId}`)).json();
  originalData = r.data;
  expect(r.data.personal).toMatchObject({ name: 'Jane Doe', email: 'jane.doe@example.com', phone: '(206) 555-0142', location: 'Seattle, WA' });
  expect(r.data.experience.map((e: { title: string; company: string }) => `${e.title} @ ${e.company}`)).toEqual(['Senior Software Engineer @ Northwind Commerce', 'Software Engineer @ Contoso Health']);
  expect(r.data.experience[0].bullets).toHaveLength(5);
  expect(r.data.education[0]).toMatchObject({ institution: 'University of Washington', degree: 'B.S.', field: 'Computer Science' });
  expect(r.data.skills.flatMap((g: { items: string[] }) => g.items)).toEqual(expect.arrayContaining(['Python', 'AWS', 'Docker', 'PostgreSQL']));
});

let matchBefore = 0;
test('Steps 4–5 — paste a job description and calculate the initial match', async () => {
  await dash.goto(`${API}/optimize?resumeId=${resumeId}`);
  await dash.getByLabel('Job description', { exact: true }).fill(BACKEND_JD);
  await dash.getByLabel('Job URL (optional)').fill(`${SITE}/greenhouse.html`);
  await dash.getByRole('button', { name: 'Analyze job & score my resume' }).click();
  const heading = dash.getByRole('heading', { name: /Current match: \d+%/ });
  await expect(heading).toBeVisible({ timeout: 30_000 });
  matchBefore = Number((await heading.textContent())!.match(/(\d+)%/)![1]);
  expect(matchBefore).toBeGreaterThan(40);
  expect(matchBefore).toBeLessThan(95);
  const analysisCard = dash.locator('.card', { has: dash.getByRole('heading', { name: 'Job analysis' }) });
  await expect(analysisCard.getByText('Senior Backend Engineer')).toBeVisible();
  await expect(analysisCard.getByText('· Globex Payments')).toBeVisible();
  // Transparent breakdown
  for (const d of ['Skills', 'Experience', 'Responsibilities', 'Keywords', 'Education', 'Seniority', 'ATS compatibility']) {
    await expect(dash.locator('.bar-row', { hasText: d }).first()).toBeVisible();
  }
});

test('Step 6 — generate an optimized resume', async () => {
  await dash.getByRole('radio', { name: /Full tailoring/ }).check();
  await dash.getByRole('button', { name: 'Generate optimized version' }).click();
  await expect(dash).toHaveURL(/\/versions\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  versionId = dash.url().split('/').pop()!;
  await expect(dash.getByRole('heading', { name: /Globex Payments — Senior Backend Engineer/ })).toBeVisible();
});

test('Step 7 — no fabrication, skills prioritized, experience emphasized, missing skills shown, original unchanged', async () => {
  const v = await (await api.get(`/api/versions/${versionId}`)).json();
  const opt = v.payload.optimized;
  const optText = JSON.stringify(opt);
  // No fabricated technologies / experience
  for (const s of ['Kubernetes', 'Terraform', 'Kafka', 'Datadog']) expect(optText).not.toContain(s);
  expect(opt.experience.map((e: { company: string; title: string; startDate: string; endDate: string }) => [e.company, e.title, e.startDate, e.endDate])).toEqual(
    (originalData as { experience: { company: string; title: string; startDate: string; endDate: string }[] }).experience.map((e) => [e.company, e.title, e.startDate, e.endDate]),
  );
  expect(opt.education).toEqual((originalData as { education: unknown }).education);
  // Every number in the optimized resume existed in the original
  const nums = (s: string) => new Set(s.match(/\d[\d,.]*%?/g) ?? []);
  const origNums = nums(JSON.stringify(originalData));
  for (const n of nums(optText)) if (!/^20\d\d/.test(n)) expect(origNums.has(n), `number ${n} not in original`).toBe(true);
  // Relevant skills prioritized
  expect(opt.skills[0].items[0]).toBe('Python');
  // Relevant existing experience emphasized (most relevant bullet first)
  expect(opt.experience[0].bullets[0].text).toMatch(/REST APIs|Python|AWS/);
  // Missing skills clearly identified in the UI
  const notAdded = dash.locator('.change', { hasText: 'Not added' });
  await expect(notAdded).toBeVisible();
  for (const s of ['Kubernetes', 'Terraform']) await expect(notAdded.locator('.chip.missing', { hasText: s })).toBeVisible();
  await expect(dash.getByText('Not found in your resume. You have related experience (Docker)').first()).toBeVisible();
  // Original unchanged
  const orig = await (await api.get(`/api/resumes/${resumeId}`)).json();
  expect(orig.data).toEqual(originalData);
});

test('Step 8 — export the optimized resume and verify formatting/content', async () => {
  // DOCX: same original file with text edited in place
  const [docxDl] = await Promise.all([dash.waitForEvent('download'), dash.getByRole('button', { name: 'DOCX' }).click()]);
  const docxPath = await docxDl.path();
  const bytes = fs.readFileSync(docxPath!);
  const back = await parseResume(new Uint8Array(bytes), 'out.docx');
  expect(back.data.experience).toHaveLength(2);
  expect(back.rawText).toContain('Built Python backend services for internal applications.');
  expect(back.rawText).not.toContain('Kubernetes');
  // Formatting preserved: styles, numbering, page setup and fonts are byte-identical to the original
  const [a, b] = await Promise.all([JSZip.loadAsync(fs.readFileSync(fixture('resumes/jane-doe.docx'))), JSZip.loadAsync(bytes)]);
  for (const part of ['word/styles.xml', 'word/numbering.xml', 'word/settings.xml']) {
    expect(await b.file(part)!.async('string'), part).toBe(await a.file(part)!.async('string'));
  }
  const docXml = await b.file('word/document.xml')!.async('string');
  expect(docXml).toContain('<w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">Languages: </w:t>'); // bold label run kept
  // PDF export opens and contains the content
  const [pdfDl] = await Promise.all([dash.waitForEvent('download'), dash.getByRole('button', { name: 'PDF' }).click()]);
  const pdf = await parseResume(new Uint8Array(fs.readFileSync((await pdfDl.path())!)), 'out.pdf');
  expect(pdf.data.personal.name.toLowerCase()).toBe('jane doe');
  expect(pdf.data.skills[0].items[0]).toBe('Python');
  // JSON
  const json = await (await api.get(`/api/versions/${versionId}/export?format=json`)).json();
  expect(json.resume.experience[1].company).toBe('Contoso Health');
});

let gh: Page;
let panel: Frame;
test('Steps 9–10 — open the mock application in Chrome and run the extension (fields detected)', async () => {
  await signInExtension(context, extensionId, email, password);
  gh = await context.newPage();
  await gh.goto(`${SITE}/greenhouse.html`);
  panel = await openPanel(gh);
  await expect(panel.getByText(/✓ (1[0-9]|[2-9][0-9]) fields detected/)).toBeVisible();
  await expect(panel.locator('.job .title')).toHaveText('Senior Backend Engineer');
  await expect(panel.getByText(/Match \d+%/)).toBeVisible(); // job recognized, tailored version recommended
  await expect(row(panel, 'First Name')).toHaveAttribute('data-status', 'ready');
  await expect(row(panel, 'legally authorized')).toHaveAttribute('data-status', 'unknown');
  await expect(row(panel, 'regulated industry')).toHaveAttribute('data-status', 'unknown');
  await expect(row(panel, 'regulated industry').getByText("I don't have a saved answer for this question.")).toBeVisible();
});

test('Steps 11–12 — autofill, answer unknown questions, remember them', async () => {
  const auth = row(panel, 'legally authorized');
  await auth.locator('.answer').selectOption('Yes');
  await auth.getByLabel('Remember this answer').check();
  const spons = row(panel, 'sponsorship');
  await spons.locator('.answer').selectOption('No');
  await spons.getByLabel('Remember this answer').check();
  const reg = row(panel, 'regulated industry');
  await reg.locator('.answer').fill('Yes — 3 years building patient scheduling software in healthcare (HIPAA).');
  await reg.getByLabel('Remember this answer').check();
  await panel.getByRole('button', { name: /^Fill \d+ fields?$/ }).click();
  await expect(panel.getByText(/Filled \d+ fields? and remembered 3 answers/)).toBeVisible({ timeout: 30_000 });

  await expect(gh.locator('#first_name')).toHaveValue('Jane');
  await expect(gh.locator('#last_name')).toHaveValue('Doe');
  // Profile import never overwrites what the user entered at sign-up (their account email).
  await expect(gh.locator('#email')).toHaveValue(email);
  await expect(gh.locator('#phone')).toHaveValue('(206) 555-0142');
  await expect(gh.locator('#question_101')).toHaveValue('https://linkedin.com/in/janedoe');
  await expect(gh.locator('#question_103')).toHaveValue('1');
  await expect(gh.locator('#question_104')).toHaveValue('0');
  await expect(gh.locator('#question_105')).toHaveValue(/healthcare \(HIPAA\)/);
  // Tailored resume attached to the upload field
  expect(await gh.locator('#resume').evaluate((el: HTMLInputElement) => el.files?.[0]?.name ?? '')).toMatch(/\.pdf$/);

  const answers = (await (await api.get('/api/answers')).json()).answers as { questionKey: string; answer: string }[];
  expect(answers.find((a) => a.questionKey === 'work_authorization:US')?.answer).toBe('Yes');
  expect(answers.find((a) => a.questionKey.startsWith('custom:'))?.answer).toMatch(/HIPAA/);
  const apps = (await (await api.get('/api/applications')).json()).applications;
  expect(apps[0]).toMatchObject({ company: 'Globex Payments', status: 'preparing' });
});

test('Step 13 — a different application with equivalent questions reuses saved answers', async () => {
  const lv = await context.newPage();
  await lv.goto(`${SITE}/lever.html`);
  const p = await openPanel(lv);
  const auth = row(p, 'authorization to work');
  await expect(auth).toHaveAttribute('data-status', 'ready');
  await expect(auth.locator('.answer')).toHaveValue('Yes');
  const reg = row(p, 'regulated industry');
  await expect(reg.locator('.answer')).toHaveValue(/HIPAA/);
  await p.getByRole('button', { name: /^Fill \d+ fields?$/ }).click();
  await expect(p.getByText(/Filled \d+ field/)).toBeVisible({ timeout: 30_000 });
  await expect(lv.locator('input[name="cards[abc][field0]"][value="Yes"]')).toBeChecked();
  await expect(lv.locator('textarea[name="cards[abc][field1]"]')).toHaveValue(/HIPAA/);
  await expect(lv.locator('input[name="name"]')).toHaveValue('Jane Doe');
  await expect(lv.locator('input[name="org"]')).toHaveValue('Northwind Commerce');
  await lv.close();
});

test('Step 14 — restart the browser; sign-in and saved answers persist', async () => {
  await context.close();
  ({ context, extensionId } = await launchWithExtension(userDataDir));
  const lv = await context.newPage();
  await lv.goto(`${SITE}/lever.html`);
  const p = await openPanel(lv);
  await expect(row(p, 'authorization to work')).toHaveAttribute('data-status', 'ready');
  await expect(row(p, 'regulated industry').locator('.answer')).toHaveValue(/HIPAA/);
  await lv.close();
  dash = await context.newPage();
});

test('Step 15 — submitting creates the confirmed application record in the dashboard', async () => {
  gh = await context.newPage();
  await gh.goto(`${SITE}/greenhouse.html`);
  const p = await openPanel(gh);
  await p.getByRole('button', { name: /^Fill \d+ fields?$/ }).click();
  await expect(p.getByText(/Filled \d+ field/)).toBeVisible({ timeout: 30_000 });
  await p.getByRole('button', { name: 'Close', exact: true }).click();
  // The user submits manually; the extension never does.
  await gh.getByRole('button', { name: 'Submit Application' }).click();
  await expect(gh).toHaveURL(/submitted\.html/);
  const confirm = gh.locator('[data-px-ui="confirm"]');
  await expect(confirm.getByText('Did you submit your application?')).toBeVisible({ timeout: 20_000 });
  await confirm.getByRole('button', { name: 'Yes, mark as applied' }).click();
  await expect(confirm.getByText('Marked as applied')).toBeVisible();

  await dash.goto(`${API}/applications`);
  const tr = dash.locator('tr', { hasText: 'Globex Payments' });
  await expect(tr).toBeVisible();
  await expect(tr.locator('select')).toHaveValue('applied');
  await expect(tr.getByText(/Applied \w{3} \d+/)).toBeVisible();
  const apps = (await (await api.get('/api/applications')).json()).applications;
  expect(apps.filter((a: { company: string }) => a.company === 'Globex Payments')).toHaveLength(1);
  expect(apps[0].resumeVersionId).toBe(versionId);
});

test('Step 16 — changing the phone number in the profile is used on the next application', async () => {
  await dash.goto(`${API}/profile`);
  const phone = dash.getByLabel('Phone', { exact: true });
  await expect(phone).toHaveValue('(206) 555-0142');
  await phone.fill('(206) 555-0199');
  await expect(dash.getByText('All changes saved')).toBeVisible();
  const wd = await context.newPage();
  await wd.goto(`${SITE}/workday.html`);
  const p = await openPanel(wd);
  await expect(row(p, 'Phone Number').locator('.answer')).toHaveValue('(206) 555-0199');
  await p.getByRole('button', { name: /^Fill \d+ fields?$/ }).click();
  await expect(p.getByText(/Filled \d+ field/)).toBeVisible({ timeout: 30_000 });
  await expect(wd.locator('#wd-4')).toHaveValue('(206) 555-0199');
  await expect(wd.locator('#wd-1')).toHaveValue('Jane');
});
