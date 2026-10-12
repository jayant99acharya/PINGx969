/**
 * Autofill on replicas of the major applicant-tracking systems (e2e/mock-site/ats), with the real extension:
 * Greenhouse (job-boards react-select), Lever, Workday (multi-step, listbox buttons), Ashby (toggle buttons),
 * Workable (ARIA radios), SmartRecruiters (shadow DOM), Jobvite (consent gate), JazzHR, BambooHR (listbox
 * buttons), iCIMS (iframe), Google Forms (ARIA widgets) and LinkedIn Easy Apply (multi-step modal).
 * Each test checks what was filled, that unknown questions stay empty and that consent is never given.
 */
import { type BrowserContext, type Frame, type Locator, type Page, expect, test } from '@playwright/test';
import { SITE, apiAs, launchWithExtension, openPanel, registerViaApi, row, signInExtension, tempProfileDir } from './helpers';

test.describe.configure({ mode: 'serial' });

const email = `ats.${Date.now()}@example.com`;
const password = 'ats-suite-pass-123';
let context: BrowserContext;

test.beforeAll(async () => {
  await registerViaApi(email, password, 'Sam Rivera');
  const api = await apiAs(email, password);
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
  await api.dispose();
  let extensionId: string;
  ({ context, extensionId } = await launchWithExtension(tempProfileDir('ats')));
  await signInExtension(context, extensionId, email, password);
});

test.afterAll(async () => {
  await context?.close();
});

async function fillAll(target: Page | Frame) {
  const panel = await openPanel(target);
  await panel.getByRole('button', { name: /^Fill \d+ fields?$/ }).click();
  await expect(panel.getByText(/Filled \d+ fields?/)).toBeVisible({ timeout: 30_000 });
  return panel;
}
const closePanel = (panel: Frame) => panel.getByRole('button', { name: 'Close', exact: true }).click();
/** react-select: the chosen option is rendered in .select__single-value next to the input. */
const rsValue = (page: Page, inputId: string): Locator => page.locator(`.select:has(#${inputId}) .select__single-value`);

test('Greenhouse (job-boards): react-select questions, async location, EEO left alone', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/ats/greenhouse-boards.html`);
  const panel = await fillAll(page);
  await expect(row(panel, 'previously worked')).toHaveAttribute('data-status', 'unknown');
  await expect(page.locator('#first_name')).toHaveValue('Sam');
  await expect(page.locator('#email')).toHaveValue(email);
  await expect(rsValue(page, 'country')).toHaveText('United States');
  await expect(rsValue(page, 'candidate-location')).toHaveText('San Francisco, California, United States');
  await expect(rsValue(page, 'question_3670003')).toHaveText('Yes');
  await expect(rsValue(page, 'question_3670004')).toHaveText('No');
  await expect(rsValue(page, 'question_3670005')).toHaveCount(0); // never guessed
  await expect(rsValue(page, 'gender')).toHaveCount(0);
  await expect(page.locator('#question_3670006')).toHaveValue('');
  await page.close();
});

test('Lever: cards questions answered, consent radios and marketing opt-in untouched', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/ats/lever.html`);
  const panel = await fillAll(page);
  await expect(row(panel, 'process my personal data')).toHaveAttribute('data-status', 'manual');
  await expect(page.locator('input[name="name"]')).toHaveValue('Sam Rivera');
  await expect(page.locator('input[name="org"]')).toHaveValue('Initrode');
  await expect(page.locator('input[name="cards[1c719ca9][field0]"][value="Yes"]')).toBeChecked();
  await expect(page.locator('input[name="cards[1c719ca9][field1]"][value="No"]')).toBeChecked();
  for (const r of await page.locator('input[name="cards[73796cde][field0]"]').all()) await expect(r).not.toBeChecked();
  await expect(page.locator('input[name="consent[marketing]"]')).not.toBeChecked();
  await expect(page.locator('input[name="cards[a69a985a][field0]"]:checked')).toHaveCount(0);
  await page.close();
});

test('Workday: listbox buttons and a 5-step wizard filled as each page renders', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/ats/workday.html`);
  const panel = await fillAll(page);
  await expect(page.locator('#name--legalName--firstName')).toHaveValue('Sam');
  await expect(page.locator('#address--city')).toHaveValue('San Francisco');
  await expect(page.locator('#address--countryRegion')).toHaveText('California');
  await expect(page.locator('#country--country')).toHaveText('United States of America'); // prefilled, kept
  await expect(page.locator('#phoneNumber--phoneType')).toHaveText('Select One'); // unknown, not guessed
  await expect(page.locator('input[name="candidateIsPreviousWorker"]:checked')).toHaveCount(0);
  await closePanel(panel);
  await page.getByRole('button', { name: 'Save and Continue' }).click();
  await expect(page.locator('#workExperience-1--companyName')).toHaveValue('Initrode');
  await expect(page.locator('#socialNetworkAccounts--linkedInAccount')).toHaveValue('https://linkedin.com/in/samr');
  await page.getByRole('button', { name: 'Save and Continue' }).click();
  await expect(page.locator('#primaryQuestionnaire--q1')).toHaveText('Yes');
  await expect(page.locator('#primaryQuestionnaire--q2')).toHaveText('No');
  await expect(page.locator('#primaryQuestionnaire--q3')).toHaveText('Select One');
  await page.getByRole('button', { name: 'Save and Continue' }).click();
  await expect(page.locator('#personalInfoUS--gender')).toHaveText('Select One');
  await expect(page.locator('[data-automation-id="agreementCheckbox"]')).not.toBeChecked();
  await page.close();
});

test('Ashby: Yes/No toggle buttons pressed, SMS consent untouched', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/ats/ashby.html`);
  const panel = await fillAll(page);
  await expect(row(panel, 'New York office')).toHaveAttribute('data-status', 'unknown');
  await expect(page.locator('#_systemfield_name')).toHaveValue('Sam Rivera');
  const toggle = (path: string, option: string) => page.locator(`[data-field-path="${path}"] button[data-option="${option}"]`);
  await expect(toggle('707824e4', 'yes')).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle('b2ed64ad', 'no')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-field-path="c3aa01"] button[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator('input[name="communicationConsent"]:checked')).toHaveCount(0);
  await expect(page.locator('#ashby-location')).toHaveValue('San Francisco, California, United States');
  await page.close();
});

test('Workable: ARIA radio wrappers clicked, GDPR checkbox untouched', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/ats/workable.html`);
  await fillAll(page);
  await expect(page.locator('#firstname')).toHaveValue('Sam');
  await expect(page.locator('#wrapper_a1')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#a1')).toBeChecked();
  await expect(page.locator('#wrapper_b2')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-ui="CA_41462"] [aria-checked="true"]')).toHaveCount(0);
  await expect(page.locator('#gdpr-box')).toHaveAttribute('aria-checked', 'false');
  await page.close();
});

test('SmartRecruiters: fields inside web-component shadow roots', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/ats/smartrecruiters.html`);
  const panel = await fillAll(page);
  await expect(row(panel, 'notice period')).toHaveAttribute('data-status', 'unknown');
  await expect(page.locator('#first-name-input')).toHaveValue('Sam'); // Playwright CSS pierces open shadow roots
  await expect(page.locator('#confirm-email-input')).toHaveValue(email);
  await expect(page.locator('spl-autocomplete input')).toHaveValue('San Francisco, CA, USA');
  await expect(page.locator('spl-select').nth(0).locator('button')).toHaveText('Yes');
  await expect(page.locator('spl-select').nth(1).locator('button')).toHaveText('No');
  await expect(page.locator('spl-checkbox input')).not.toBeChecked();
  await page.close();
});

test('Jobvite: nothing happens behind the data-consent gate; the form fills after the user accepts', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/ats/jobvite.html`);
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-px-ui="launcher"]')).toHaveCount(0); // a single select is not an application
  await page.selectOption('#jv-country-select', 'us'); // the user accepts consent themselves
  await page.click('#jv-accept');
  await fillAll(page);
  await expect(page.locator('#jv-field-a1')).toHaveValue('Sam');
  await expect(page.locator('#jv-field-a7')).toHaveValue('CA');
  await expect(page.locator('input[name="jv-q-100"][value="Yes"]')).toBeChecked();
  await expect(page.locator('input[name="jv-q-101"][value="No"]')).toBeChecked();
  await expect(page.locator('#jv-field-a9')).toHaveValue('');
  await expect(page.locator('input[name="certify"]')).not.toBeChecked();
  await page.close();
});

test('JazzHR: resumator fields, eligibility select, numbered checkbox group left for the user', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/ats/jazzhr.html`);
  const panel = await fillAll(page);
  await expect(row(panel, 'used in production')).toHaveAttribute('data-status', 'unknown');
  await expect(page.locator('#resumator-firstname-value')).toHaveValue('Sam');
  await expect(page.locator('#resumator-city-value')).toHaveValue('San Francisco');
  await expect(page.locator('#resumator-postal-value')).toHaveValue('94105');
  await expect(page.locator('#resumator-citizen-value')).toHaveValue('2');
  await expect(page.locator('.resumator-questionnaire-checkbox:checked')).toHaveCount(0);
  await expect(page.locator('#resumator-salary-value')).toHaveValue('');
  await page.close();
});

test('BambooHR: fab-SelectToggle dropdowns opened and chosen', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/ats/bamboohr.html`);
  await fillAll(page);
  await expect(page.locator('#firstName')).toHaveValue('Sam');
  await expect(page.locator('#state')).toHaveText('California');
  await expect(page.locator('#countryId')).toHaveText('United States');
  await expect(page.locator('#customQuestions-1')).toHaveText('Yes');
  await expect(page.locator('#customQuestions-2')).toHaveText('No');
  await expect(page.locator('#customQuestions-3')).toHaveValue('');
  await expect(page.locator('.menu-portal')).toHaveCount(0); // menus closed again
  await page.close();
});

test('iCIMS: the form inside #icims_content_iframe is filled; launcher and panel live in the top page', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/ats/icims.html`);
  const frame = page.frame({ url: /icims-frame\.html/ })!;
  await frame.waitForLoadState();
  // Candidate login step (email + privacy acknowledgement) is the user's to complete: no launcher yet.
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-px-ui="launcher"]')).toHaveCount(0);
  await frame.fill('#email', email);
  await frame.check('#enterEmailAgreement');
  await frame.click('#enterEmailSubmitButton');
  // The content-sized iframe is taller than the viewport: its own fixed launcher would be off-screen.
  const panel = await fillAll(page);
  await expect(row(panel, 'Email')).toHaveAttribute('data-status', 'prefilled');
  await expect(frame.locator('[data-px-ui]')).toHaveCount(0);
  await expect(frame.locator('[name="PersonProfileFields.FirstName"]')).toHaveValue('Sam');
  await expect(frame.locator('[name="PersonProfileFields.AddressState"]')).toHaveValue('CA');
  await expect(frame.locator('#rcf3048')).toHaveValue('Yes');
  await expect(frame.locator('#rcf3049')).toHaveValue('No');
  await expect(frame.locator('#rcf3050')).toHaveValue('');
  await expect(frame.locator('input[name="certify"]')).not.toBeChecked();
  await page.close();
});

test('Google Forms: ARIA radios and listbox dropdown, hidden entry.* answers updated', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/ats/google-forms.html`);
  const panel = await fillAll(page);
  await expect(row(panel, 'Position Applied for')).toHaveAttribute('data-status', 'unknown');
  await expect(page.locator('input[aria-labelledby="i1 i2"]')).toHaveValue('Sam Rivera');
  await expect(page.locator('input[name="entry.1005"]')).toHaveValue('Yes');
  await expect(page.locator('input[name="entry.1006"]')).toHaveValue('No');
  await expect(page.locator('input[name="entry.1009"]')).toHaveValue('United States');
  await expect(page.locator('input[name="entry.1007"]')).toHaveValue(''); // marital status: never guessed
  await expect(page.locator('input[name="entry.1008"]')).toHaveValue('');
  await page.close();
});

test('Zoho Recruit: cx-prop-label captions, Lyte picklists portalled to <body>, dial code + national number', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/ats/zohorecruit.html`);
  const panel = await fillAll(page);
  await expect(row(panel, 'Salutation')).toHaveAttribute('data-status', 'unknown');
  const input = (name: string) => page.locator(`input[name="${name}"]`);
  const pick = (label: string) => page.locator(`crux-picklist-component[cx-prop-label="${label}"] [role="combobox"]`);
  await expect(input('rec-form_1542')).toHaveValue('Sam');
  await expect(input('rec-form_1548')).toHaveValue(email);
  await expect(page.locator('crux-phone-component [role="combobox"]')).toHaveText('United States (+1)');
  await expect(input('rec-form_1554')).toHaveValue('415 555 0100');
  await expect(input('rec-form_1568')).toHaveValue('Initrode');
  await expect(pick('Are you legally authorized to work in the United States?')).toHaveText('Yes');
  await expect(pick('Will you now or in the future require visa sponsorship?')).toHaveText('No');
  await expect(pick('Salutation')).toHaveText('-None-');
  await expect(pick('How did you hear about this position?')).toHaveText('-None-');
  await expect(input('rec-form_3126')).toHaveValue(''); // expected salary: not in the profile, never guessed
  await expect(page.locator('body > lyte-drop-box:not(.lyteDropdownHidden)')).toHaveCount(0); // menus closed again
  await page.close();
});

test('Oracle Cloud (Recruiting CE): email step left to the user, JET dropdowns and pills filled, e-signature never typed', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/ats/oraclecloud.html`);
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-px-ui="launcher"]')).toHaveCount(0); // email + terms only
  await page.fill('#primary-email-0', email);
  await page.check('#legal-disclaimer-checkbox');
  await page.click('#next');
  const panel = await fillAll(page);
  await expect(row(panel, 'Full Name')).toHaveAttribute('data-status', 'manual');
  await expect(page.locator('#firstName-2')).toHaveValue('Sam');
  await expect(page.locator('#phoneCode-4')).toHaveValue('United States (+1)');
  await expect(page.locator('#phone-5')).toHaveValue('415 555 0100');
  await expect(page.locator('#state-8')).toHaveValue('California');
  await expect(page.locator('#city-7')).toHaveValue('San Francisco, CA');
  const pill = (q: string, option: string) => page.locator(`[aria-labelledby="${q}-label"] button`, { hasText: option });
  await expect(pill('q1', 'Yes')).toHaveAttribute('aria-pressed', 'true');
  await expect(pill('q2', 'No')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[aria-labelledby="q3-label"] button[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator('#esign-12')).toHaveValue('');
  await expect(page.locator('input[name="honey-pot"]')).toHaveCount(0); // the honeypot lived on the email step
  await page.close();
});

test('Kula (Next.js + Chakra): form behind the "Application form" tab, dangling labels, page-default phone country kept', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/ats/kula.html`);
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-px-ui="launcher"]')).toHaveCount(0); // job description tab only
  await page.getByRole('tab', { name: 'Application form' }).click();
  const panel = await fillAll(page);
  await expect(row(panel, 'Selenium')).toHaveAttribute('data-status', 'unknown'); // never answers per-tool years with total years
  await expect(page.locator('#info\\.first_name')).toHaveValue('Sam');
  await expect(page.locator('#info\\.email')).toHaveValue(email);
  await expect(page.locator('#info\\.linkedin_url')).toHaveValue('https://linkedin.com/in/samr');
  await expect(page.locator('.phone-country')).toHaveText(/\+91/); // page default kept…
  await expect(page.locator('#phone')).toHaveValue('+1 415 555 0100'); // …so the number keeps its own +1
  await expect(page.locator('#radio-_r_30_')).toBeChecked();
  await expect(page.locator('input[name="radio-_r_33_"]:checked')).toHaveCount(0);
  await expect(page.locator('#additional_info\\._9213')).toHaveValue('');
  await page.close();
});

test('Keka: select2 country code set through its hidden <select>, national number, consent and captcha untouched', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/ats/keka.html`);
  const panel = await fillAll(page);
  await expect(row(panel, 'I agree')).toHaveAttribute('data-status', 'manual');
  await expect(page.locator('#firstName')).toHaveValue('Sam');
  await expect(page.locator('[name="mobilePhone.countryCode"]')).toHaveValue('+1');
  await expect(page.locator('#select2-mobilePhonecountryCode-container')).toHaveText('+1'); // select2 followed the change
  await expect(page.locator('[name="mobilePhone.number"]')).toHaveValue('415 555 0100');
  await expect(page.locator('#workExperience')).toHaveValue(/^\d+$/);
  await expect(page.locator('#currentLocation')).toHaveValue('San Francisco, CA');
  await expect(page.locator('#gender')).toHaveValue('');
  await expect(page.locator('#expectedSalary')).toHaveValue('');
  await expect(page.locator('#candidateConsent')).not.toBeChecked();
  await expect(page.locator('#captcha')).toHaveValue('');
  await page.close();
});

test('Teamtailor: hidden "Required" stripped from labels, consent boxes untouched', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/ats/teamtailor.html`);
  const panel = await fillAll(page);
  await expect(row(panel, 'Upload CV')).toBeVisible();
  await expect(page.locator('#candidate_first_name')).toHaveValue('Sam');
  await expect(page.locator('#candidate_phone')).toHaveValue('+1 415 555 0100');
  await expect(page.locator('input[name="candidate[answers][1]"][value="Yes"]')).toBeChecked();
  await expect(page.locator('input[name="candidate[answers][2]"][value="No"]')).toBeChecked();
  await expect(page.locator('#candidate_answers_3')).toHaveValue('');
  await expect(page.locator('input[type=checkbox]:checked')).toHaveCount(0);
  await page.close();
});

test('Rippling: "Select" dropdowns answered from their question, SMS opt-in left alone', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/ats/rippling.html`);
  const panel = await fillAll(page);
  await expect(row(panel, 'text messages')).toHaveAttribute('data-status', 'manual');
  await expect(page.locator('#firstName')).toHaveValue('Sam');
  await expect(page.locator('#field-63')).toHaveText('Yes');
  await expect(page.locator('#field-69')).toHaveText('No');
  await expect(page.locator('#field-75')).toHaveText('Select'); // in-office question: never guessed
  await expect(page.locator('[role=radio][aria-checked=true]')).toHaveCount(0);
  await page.close();
});

test('Recruitee: the pre-typed "+31" is replaced by the full number; country default kept', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/ats/recruitee.html`);
  await fillAll(page);
  await expect(page.locator('#candidate-name')).toHaveValue('Sam Rivera');
  await expect(page.locator('#candidate-phone')).toHaveValue('+1 415 555 0100');
  await expect(page.locator('.cc-button')).toHaveText(/\+31/);
  await expect(page.locator('input[value="No"][name*="[1]"]')).toBeChecked();
  await expect(page.locator('#candidate-notice')).toHaveValue('');
  await page.close();
});

test('Breezy HR: salary currency/period kept, SMS consent unticked', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/ats/breezy.html`);
  await fillAll(page);
  await expect(page.locator('#name')).toHaveValue('Sam Rivera');
  await expect(page.locator('#address')).toHaveValue('500 Market St');
  await expect(page.locator('#salary_currency')).toHaveValue('USD');
  await expect(page.locator('#salary')).toHaveValue('');
  await expect(page.locator('input[name="sms_opt_in"]')).not.toBeChecked();
  await page.close();
});

test('Personio: US authorization answered, Germany left for the user, privacy box unticked', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/ats/personio.html`);
  const panel = await fillAll(page);
  await expect(row(panel, 'Germany')).toHaveAttribute('data-status', 'unknown');
  await expect(page.locator('#first_name')).toHaveValue('Sam');
  await expect(page.locator('#auth_us')).toHaveValue('Yes');
  await expect(page.locator('#auth_de')).toHaveValue('');
  await expect(page.locator('#german')).toHaveValue('');
  await expect(page.locator('input[name="privacy_policy_acceptance"]')).not.toBeChecked();
  await page.close();
});

test('Late whole-document hydration (Greenhouse job-boards / Remix): no UI before hydration, autofill afterwards', async () => {
  const page = await context.newPage();
  const mismatches: string[] = [];
  page.on('console', (m) => /Hydration failed/.test(m.text()) && mismatches.push(m.text()));
  await page.goto(`${SITE}/ats/hydration.html`);
  await expect(page.locator('html[data-hydrated]')).toBeAttached({ timeout: 10_000 });
  await fillAll(page);
  expect(mismatches).toEqual([]);
  await expect(page.locator('#first_name')).toHaveValue('Sam');
  await expect(page.locator('#phone')).toHaveValue('+1 415 555 0100');
  await page.close();
});

test('LinkedIn Easy Apply: modal steps filled as they appear, country code + national number', async () => {
  const page = await context.newPage();
  await page.goto(`${SITE}/ats/linkedin.html`);
  await page.waitForTimeout(800);
  await expect(page.locator('[data-px-ui="launcher"]')).toHaveCount(0); // job page without a form
  await page.getByRole('button', { name: 'Easy Apply' }).click();
  const panel = await fillAll(page);
  await expect(page.locator('#single-line-text-form-component-firstName')).toHaveValue('Sam');
  // The only verified LinkedIn email differs from the profile email: flagged for review, not guessed.
  await expect(row(panel, 'Email address')).toHaveAttribute('data-status', 'review');
  await expect(page.locator('#text-entity-list-form-component-email')).toHaveValue('Select an option');
  await expect(page.locator('#text-entity-list-form-component-phoneNumber-country')).toHaveValue('United States (+1)');
  await expect(page.locator('#single-line-text-form-component-phoneNumber-nationalNumber')).toHaveValue('415 555 0100');
  await closePanel(panel);
  await page.getByRole('button', { name: 'Continue to next step' }).click(); // → resume
  await page.getByRole('button', { name: 'Continue to next step' }).click(); // → additional questions
  await expect(page.locator('#q2-yes')).toBeChecked();
  await expect(page.locator('#text-entity-list-form-component-q3')).toHaveValue('No');
  await expect(page.locator('#single-line-text-form-component-q1')).toHaveValue('');
  await page.close();
});
