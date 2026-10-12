// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeEach } from 'vitest';
import { ProfileSchema, emptyProfile, mergeProfile } from '@pingx969/shared';
import { normalizeQuestion } from '@pingx969/profile';
import { detectFields, extractJobInfo, fillField, looksLikeApplication, planFill, readValue, summarizePlan, watchForFields, attachFile, pickAdapter, type AutofillData } from '../src';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../e2e/mock-site');

function load(file: string, url = `http://localhost:4100/${file}`) {
  const html = fs.readFileSync(path.join(site, file), 'utf8').replace(/<script src="\/mock.js"><\/script>/, '');
  document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/i, '').replace(/<\/html>\s*$/i, '');
  // jsdom doesn't execute scripts assigned via innerHTML; tests drive dynamic behavior directly.
  return url;
}

const profile = mergeProfile(emptyProfile(), {
  personal: { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '(206) 555-0142' },
  location: { address1: '1 Pine St', city: 'Seattle', state: 'WA', postalCode: '98101', country: 'United States' },
  links: { linkedin: 'https://linkedin.com/in/janedoe', github: 'https://github.com/janedoe', website: 'https://janedoe.dev' },
  experience: [{ company: 'Northwind Commerce', title: 'Senior Software Engineer', startDate: '2018-06', current: true }],
  workAuthorization: { authorizedCountries: ['United States'], requiresSponsorship: 'no' },
  preferences: { willingToRelocate: 'no' },
  eeo: { gender: 'Prefer not to say', veteranStatus: 'I am not a protected veteran' },
});
const data = (over: Partial<AutofillData> = {}): AutofillData => ({ profile: ProfileSchema.parse(profile), answers: [], mappings: [], ...over });
const byLabel = (fields: ReturnType<typeof detectFields>, re: RegExp) => fields.find((f) => re.test(f.label))!;

beforeEach(() => {
  document.documentElement.innerHTML = '<head></head><body></body>';
});

describe('field detection — Greenhouse-style page (Application A)', () => {
  it('detects and classifies standard and question fields', () => {
    const url = load('greenhouse.html');
    const fields = detectFields(document, { url });
    expect(pickAdapter(url, document).name).toBe('greenhouse');
    expect(looksLikeApplication(fields)).toBe(true);
    const types = Object.fromEntries(fields.map((f) => [f.label, f.fieldType]));
    expect(types['First Name']).toBe('firstName');
    expect(types['Last Name']).toBe('lastName');
    expect(types['Email']).toBe('email');
    expect(types['Phone']).toBe('phone');
    expect(types['Resume/CV']).toBe('resume');
    expect(types['LinkedIn Profile']).toBe('linkedin');
    expect(types['Website']).toBe('website');
    const auth = byLabel(fields, /legally authorized/);
    expect(auth.fieldType).toBe('workAuthorization');
    expect(auth.questionKey).toBe('work_authorization:US');
    expect(byLabel(fields, /sponsorship/).questionKey).toBe('sponsorship_required:ANY'); // no country named in the question
    expect(byLabel(fields, /^Gender/).fieldType).toBe('gender');
    expect(byLabel(fields, /^Gender/).sensitive).toBe(true);
    const custom = byLabel(fields, /regulated industry/);
    expect(custom.fieldType).toBe('question');
    expect(custom.questionKey).toMatch(/^custom:/);
  });

  it('extracts job info from JSON-LD', () => {
    load('greenhouse.html');
    const info = extractJobInfo(document, 'http://localhost:4100/greenhouse.html');
    expect(info).toMatchObject({ title: 'Senior Backend Engineer', company: 'Globex Payments', source: 'jsonld' });
    expect(info.description).toContain('payment infrastructure');
  });

  it('plans and fills values from the profile without guessing unknown questions', async () => {
    const url = load('greenhouse.html');
    const fields = detectFields(document, { url });
    const plan = planFill(fields, data(), { host: 'localhost' });
    const get = (re: RegExp) => plan.find((p) => re.test(p.label))!;
    expect(get(/First Name/)).toMatchObject({ status: 'ready', value: 'Jane' });
    expect(get(/legally authorized/)).toMatchObject({ status: 'ready', value: 'Yes', source: 'profile' });
    expect(get(/sponsorship/)).toMatchObject({ status: 'ready', value: 'No' });
    expect(get(/regulated industry/)).toMatchObject({ status: 'unknown', value: '' });
    expect(get(/^Gender/)).toMatchObject({ value: 'Decline To Self Identify' });
    const sum = summarizePlan(plan);
    expect(sum.detected).toBeGreaterThan(10);
    expect(sum.unknown).toBeGreaterThanOrEqual(2);

    for (const item of plan.filter((p) => p.status === 'ready')) {
      const f = fields.find((x) => x.id === item.fieldId)!;
      const r = await fillField(document, f, item.value);
      expect(r.ok, `${item.label}: ${r.reason}`).toBe(true);
    }
    expect((document.getElementById('first_name') as HTMLInputElement).value).toBe('Jane');
    expect((document.getElementById('email') as HTMLInputElement).value).toBe('jane.doe@example.com');
    expect((document.getElementById('question_103') as HTMLSelectElement).value).toBe('1');
    expect((document.getElementById('question_104') as HTMLSelectElement).value).toBe('0');
    expect((document.getElementById('veteran') as HTMLSelectElement).value).toBe('1');
    expect((document.getElementById('question_105') as HTMLTextAreaElement).value).toBe('');
  });

  it('attaches a resume file via DataTransfer when supported', () => {
    const url = load('greenhouse.html');
    const field = detectFields(document, { url }).find((f) => f.fieldType === 'resume')!;
    const r = attachFile(document, field, { bytes: new TextEncoder().encode('resume'), name: 'Jane-Doe.pdf', type: 'application/pdf' });
    // jsdom lacks DataTransfer; real Chrome supports it (covered by the E2E suite)
    if ('DataTransfer' in window) expect(r.ok).toBe(true);
    else expect(r).toMatchObject({ ok: false });
  });
});

describe('field detection — Lever-style page (Application B)', () => {
  it('maps semantically equivalent questions to the same key as Application A', () => {
    const url = load('lever.html');
    const fields = detectFields(document, { url });
    expect(pickAdapter(url, document).name).toBe('lever');
    const types = Object.fromEntries(fields.map((f) => [f.label, f.fieldType]));
    expect(types['Full name']).toBe('fullName');
    expect(types['Current company']).toBe('currentCompany');
    expect(types['LinkedIn URL']).toBe('linkedin');
    expect(types['GitHub URL']).toBe('github');
    const auth = byLabel(fields, /authorization to work/);
    expect(auth.kind).toBe('radio');
    expect(auth.questionKey).toBe('work_authorization:US');
    expect(auth.options.map((o) => o.label)).toEqual(['Yes', 'No']);
    const cloud = byLabel(fields, /cloud providers/);
    expect(cloud.kind).toBe('checkbox-group');
  });

  it('suggests a saved answer for an equivalent custom question asked differently', () => {
    const url = load('lever.html');
    const fields = detectFields(document, { url });
    const savedQ = 'Do you have experience working in a regulated industry such as finance or healthcare?';
    const answers = [{ id: 'a1', questionKey: normalizeQuestion(savedQ).key, rawQuestion: savedQ, normalizedQuestion: savedQ, answer: 'Yes — 3 years in healthcare (HIPAA).' }];
    const plan = planFill(fields, data({ answers }), { host: 'localhost' });
    const item = plan.find((p) => /regulated industry/.test(p.label))!;
    expect(item.value).toBe('Yes — 3 years in healthcare (HIPAA).');
    expect(['ready', 'review']).toContain(item.status);
    expect(item.source).toBe('saved');
  });

  it('fills radio buttons and checkbox groups', async () => {
    const url = load('lever.html');
    const fields = detectFields(document, { url });
    const auth = byLabel(fields, /authorization to work/);
    expect((await fillField(document, auth, 'Yes')).ok).toBe(true);
    expect((document.querySelector('input[value="Yes"]') as HTMLInputElement).checked).toBe(true);
    const cloud = byLabel(fields, /cloud providers/);
    expect((await fillField(document, cloud, 'AWS, Google Cloud')).ok).toBe(true);
    expect(readValue(document, cloud)).toBe('AWS, Google Cloud');
  });
});

describe('prefilled fields', () => {
  it('never overwrites existing values unless asked', async () => {
    const url = load('prefilled.html');
    const fields = detectFields(document, { url });
    const plan = planFill(fields, data(), { host: 'localhost' });
    const first = plan.find((p) => p.label === 'First name')!;
    expect(first.status).toBe('prefilled');
    expect(first.note).toContain('Janet');
    const email = plan.find((p) => p.label === 'Email')!;
    expect(email.status).toBe('prefilled');
    const country = plan.find((p) => p.label === 'Country')!;
    expect(country.status).toBe('prefilled');
    const f = fields.find((x) => x.label === 'First name')!;
    expect((await fillField(document, f, 'Jane')).ok).toBe(false);
    expect((document.getElementById('pf-first') as HTMLInputElement).value).toBe('Janet');
    expect((await fillField(document, f, 'Jane', { overwrite: true })).ok).toBe(true);
    expect((document.getElementById('pf-first') as HTMLInputElement).value).toBe('Jane');
    expect(plan.find((p) => p.label === 'Last name')).toMatchObject({ status: 'ready', value: 'Doe' });
  });
});

describe('Workday-style page: dropdowns, radios, checkboxes, consent', () => {
  it('uses automation ids, fills selects/radios and never ticks consent boxes', async () => {
    const url = load('workday.html');
    const fields = detectFields(document, { url });
    expect(pickAdapter(url, document).name).toBe('workday');
    const types = Object.fromEntries(fields.map((f) => [f.label, f.fieldType]));
    expect(types['Given Name(s)']).toBe('firstName');
    expect(types['Family Name']).toBe('lastName');
    expect(types['State']).toBe('state');
    expect(types['Country']).toBe('country');
    const plan = planFill(fields, data(), { host: 'localhost' });
    const p = (re: RegExp) => plan.find((x) => re.test(x.label))!;
    expect(p(/^State$/)).toMatchObject({ status: 'ready', value: 'Washington' });
    expect(p(/^Country$/)).toMatchObject({ value: 'United States of America' });
    expect(p(/eligible to work/)).toMatchObject({ value: 'Yes' });
    expect(p(/relocate/)).toMatchObject({ status: 'review', value: 'No' }); // contextual -> confirm
    expect(p(/certify/)).toMatchObject({ status: 'manual' });
    expect(p(/Years of professional experience/).fieldType).toBe('yearsExperience');
    for (const item of plan.filter((x) => x.status === 'ready' || x.status === 'review')) {
      if (!item.value) continue;
      const f = fields.find((x) => x.id === item.fieldId)!;
      await fillField(document, f, item.value);
    }
    expect((document.getElementById('wd-7') as HTMLSelectElement).value).toBe('WA');
    expect((document.getElementById('wd-9') as HTMLSelectElement).value).toBe('usa');
    expect((document.querySelector('input[name="wd-elig"][value="1"]') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('wd-certify') as HTMLInputElement).checked).toBe(false);
  });
});

describe('dynamic forms', () => {
  it('detects newly added fields via MutationObserver and fills them', async () => {
    const url = load('dynamic.html');
    let fields = detectFields(document, { url });
    expect(fields.map((f) => f.fieldType)).toEqual(['firstName', 'lastName', 'email']);
    let notified = 0;
    const stop = watchForFields(document.body, () => notified++, 20);
    const mount = document.getElementById('step2-mount')!;
    mount.innerHTML = '<section><label for="tel">Mobile number</label><input id="tel" type="tel" /><label for="spons">Do you require visa sponsorship to work in the US?</label><select id="spons"><option value="">Select…</option><option>Yes</option><option>No</option></select></section>';
    await new Promise((r) => setTimeout(r, 80));
    stop();
    expect(notified).toBeGreaterThan(0);
    const before = new Set(fields.map((f) => f.id));
    fields = detectFields(document, { url });
    const added = fields.filter((f) => !before.has(f.id));
    expect(added.map((f) => f.fieldType)).toEqual(['phone', 'sponsorship']);
    // Existing field ids are stable across rescans
    expect(fields.slice(0, 3).every((f) => before.has(f.id))).toBe(true);
    const plan = planFill(added, data(), { host: 'localhost' });
    for (const item of plan) await fillField(document, added.find((f) => f.id === item.fieldId)!, item.value);
    expect((document.getElementById('tel') as HTMLInputElement).value).toBe('(206) 555-0142');
    expect((document.getElementById('spons') as HTMLSelectElement).value).toBe('No');
  });

  it('fires input/change events so framework-controlled inputs keep the value', async () => {
    const url = load('dynamic.html');
    const mail = document.getElementById('mail') as HTMLInputElement;
    const state = { mail: '' };
    mail.addEventListener('input', () => (state.mail = mail.value));
    const field = detectFields(document, { url }).find((f) => f.fieldType === 'email')!;
    await fillField(document, field, 'jane.doe@example.com');
    expect(state.mail).toBe('jane.doe@example.com');
  });
});

describe('field mappings learned from user corrections', () => {
  it('a saved mapping overrides the detector for that site', () => {
    const url = load('greenhouse.html');
    const fields = detectFields(document, { url });
    const how = byLabel(fields, /How did you hear/);
    const plan = planFill(fields, data({ mappings: [{ host: 'localhost', signature: how.signature, fieldType: 'linkedin', questionKey: null }] }), { host: 'localhost' });
    expect(plan.find((p) => p.fieldId === how.id)).toMatchObject({ fieldType: 'linkedin', value: 'https://linkedin.com/in/janedoe', source: 'mapping' });
  });
});

describe('safety', () => {
  it('ignores password, hidden and search fields', () => {
    document.body.innerHTML = '<form><label>Email <input type="email" name="email"/></label><label>Password <input type="password" name="pw"/></label><input type="hidden" name="token" value="x"/><input type="search" name="q"/></form>';
    const fields = detectFields(document, { url: 'https://example.com/apply' });
    expect(fields.map((f) => f.fieldType)).toEqual(['email']);
  });
});
