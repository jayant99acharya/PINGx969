// @vitest-environment jsdom
// Detection on the ATS replicas in e2e/mock-site/ats (modelled on live Greenhouse, Lever, Ashby, Workable,
// SmartRecruiters, JazzHR, Google Forms pages and on Workday, BambooHR, Jobvite, iCIMS, LinkedIn markup).
// jsdom does not run the pages' scripts, so widget behaviour is exercised in the Playwright suite (e2e/ats.spec.ts).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProfileSchema, emptyProfile, mergeProfile } from '@pingx969/shared';
import { type DetectedField, detectFields, elementsFor, extractJobInfo, fillField, pickAdapter, planFill, readValue } from '../src';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../e2e/mock-site/ats');

function load(file: string) {
  const html = fs.readFileSync(path.join(site, file), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/i, '').replace(/<\/html>\s*$/i, '');
  return `http://localhost:4100/ats/${file}`;
}

const profile = ProfileSchema.parse(
  mergeProfile(emptyProfile(), {
    personal: { firstName: 'Sam', lastName: 'Rivera', email: 'sam@example.com', phone: '+1 415 555 0100' },
    location: { city: 'San Francisco', state: 'CA', postalCode: '94105', country: 'United States' },
    links: { linkedin: 'https://linkedin.com/in/samr' },
    workAuthorization: { authorizedCountries: ['United States'], requiresSponsorship: 'no' },
  }),
);
const plan = (fields: DetectedField[]) => planFill(fields, { profile, answers: [], mappings: [] }, { host: 'localhost' });
const byLabel = (fields: DetectedField[], re: RegExp) => {
  const f = fields.find((x) => re.test(x.label));
  if (!f) throw new Error(`no field ${re}: ${fields.map((x) => x.label).join(' | ')}`);
  return f;
};

beforeEach(() => {
  document.documentElement.innerHTML = '<head></head><body></body>';
});

describe('adapter selection', () => {
  it('prefers the ATS whose domain the page is on over DOM fingerprints', () => {
    load('lever.html');
    expect(pickAdapter('https://jobs.lever.co/initech/123/apply', document).name).toBe('lever');
    expect(pickAdapter('https://boards.greenhouse.io/initech/jobs/1', document).name).toBe('greenhouse');
    expect(pickAdapter('http://localhost:4100/ats/lever.html', document).name).toBe('lever'); // DOM fallback
  });
  it.each([
    ['greenhouse-boards.html', 'greenhouse'],
    ['ashby.html', 'ashby'],
    ['workable.html', 'workable'],
    ['jazzhr.html', 'jazzhr'],
    ['bamboohr.html', 'bamboohr'],
    ['icims-frame.html', 'icims'],
    ['google-forms.html', 'google-forms'],
    ['smartrecruiters.html', 'smartrecruiters'],
  ])('%s → %s', (file, name) => {
    const url = load(file);
    expect(pickAdapter(url, document).name).toBe(name);
  });
});

describe('Workable: role=radio wrappers around hidden native radios', () => {
  it('uses the ARIA widgets, skips the backing inputs and strips SVG fallback text', () => {
    const url = load('workable.html');
    const fields = detectFields(document, { url });
    const auth = byLabel(fields, /legally authorized/);
    expect(auth).toMatchObject({ kind: 'radio', widget: 'aria', fieldType: 'workAuthorization' });
    expect(auth.options.map((o) => o.label)).toEqual(['Yes', 'No']);
    expect(fields.filter((f) => f.widget === 'native' && f.kind === 'radio')).toHaveLength(0);
    expect(fields.some((f) => /SVGs not supported/.test(f.label + f.options.map((o) => o.label).join()))).toBe(false);
    const gdpr = byLabel(fields, /Privacy Notice/);
    expect(gdpr).toMatchObject({ kind: 'checkbox', widget: 'aria', consent: true });
    const p = plan(fields);
    expect(p.find((i) => i.fieldId === auth.id)).toMatchObject({ status: 'ready', value: 'Yes' });
    expect(p.find((i) => i.fieldId === gdpr.id)?.status).toBe('manual');
  });

  it('fills an ARIA radio group by clicking the option', async () => {
    const url = load('workable.html');
    // stand-in for the page script
    document.querySelectorAll('[role="radio"]').forEach((r) => r.addEventListener('click', () => r.parentElement!.querySelectorAll('[role="radio"]').forEach((o) => o.setAttribute('aria-checked', String(o === r)))));
    const f = byLabel(detectFields(document, { url }), /sponsorship/);
    expect(await fillField(document, f, 'No')).toMatchObject({ ok: true });
    expect(readValue(document, f)).toBe('No');
    expect(document.getElementById('wrapper_b2')!.getAttribute('aria-checked')).toBe('true');
  });
});

describe('Ashby: Yes/No as aria-pressed buttons', () => {
  it('detects toggle rows with the question label and ignores the mirrored checkbox', async () => {
    const url = load('ashby.html');
    document.querySelectorAll('.toggle-row button').forEach((b) => b.addEventListener('click', () => b.parentElement!.querySelectorAll('button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)))));
    const fields = detectFields(document, { url });
    const auth = byLabel(fields, /legally authorized/);
    expect(auth).toMatchObject({ kind: 'radio', widget: 'toggle', fieldType: 'workAuthorization' });
    expect(fields.filter((f) => f.kind === 'checkbox')).toHaveLength(0);
    expect(byLabel(fields, /Text message consent/).consent).toBe(true); // "Yes - I consent…" radios are never answered
    expect(byLabel(fields, /New York office/).fieldType).toBe('question');
    expect(await fillField(document, auth, 'Yes')).toMatchObject({ ok: true });
    expect(readValue(document, auth)).toBe('Yes');
  });
});

describe('Google Forms: ARIA radios, checkbox lists and a listbox dropdown', () => {
  it('labels questions from their headings and reads options', () => {
    const url = load('google-forms.html');
    const fields = detectFields(document, { url });
    expect(byLabel(fields, /^Full Name$/).fieldType).toBe('fullName');
    expect(byLabel(fields, /^Email Id$/).fieldType).toBe('email');
    expect(byLabel(fields, /legally authorized/)).toMatchObject({ kind: 'radio', widget: 'aria' });
    expect(byLabel(fields, /Which of these/)).toMatchObject({ kind: 'checkbox-group', widget: 'aria' });
    const country = byLabel(fields, /Country of residence/);
    expect(country).toMatchObject({ kind: 'select', widget: 'listbox', currentValue: '' });
    expect(country.options.map((o) => o.label)).toEqual(['India', 'United States', 'United Kingdom']);
    expect(plan(fields).find((i) => i.fieldId === country.id)).toMatchObject({ status: 'ready', value: 'United States' });
  });
});

describe('JazzHR: one checkbox name per option, placeholder-only address parts', () => {
  it('groups numbered checkboxes into one question and labels address parts by placeholder', () => {
    const url = load('jazzhr.html');
    const fields = detectFields(document, { url });
    const used = byLabel(fields, /Which of these have you used/);
    expect(used.kind).toBe('checkbox-group');
    expect(used.options.map((o) => o.label)).toEqual(['AWS', 'Docker', 'Kubernetes', 'GraphQL']);
    expect(byLabel(fields, /^City$/).fieldType).toBe('city');
    expect(byLabel(fields, /^State\/Province$/).fieldType).toBe('state');
  });
});

describe('BambooHR: listbox buttons', () => {
  it('treats "–Select–" as empty and plans profile values', () => {
    const url = load('bamboohr.html');
    const fields = detectFields(document, { url });
    const state = byLabel(fields, /^State$/);
    expect(state).toMatchObject({ kind: 'select', widget: 'listbox', fieldType: 'state', currentValue: '' });
    expect(plan(fields).find((i) => i.fieldId === byLabel(fields, /sponsorship/).id)).toMatchObject({ status: 'ready', value: 'No' });
  });
});

describe('Greenhouse job-boards: react-select comboboxes', () => {
  it('labels comboboxes via aria-labelledby and file inputs by their caption, not "Attach"', () => {
    const url = load('greenhouse-boards.html');
    const fields = detectFields(document, { url });
    expect(byLabel(fields, /legally authorized/)).toMatchObject({ kind: 'combobox', fieldType: 'workAuthorization' });
    expect(fields.find((f) => f.kind === 'file' && f.fieldType === 'resume')?.label).toBe('Resume/CV');
    expect(fields.some((f) => f.label === 'Attach')).toBe(false);
  });
});

describe('Lever: consent radios and card checkboxes', () => {
  it('never plans an answer for "Yes, I consent / No, I do not consent"', () => {
    const url = load('lever.html');
    const fields = detectFields(document, { url });
    const consent = byLabel(fields, /process my personal data/);
    expect(consent.consent).toBe(true);
    expect(plan(fields).find((i) => i.fieldId === consent.id)?.status).toBe('manual');
    expect(byLabel(fields, /languages/).kind).toBe('checkbox-group');
  });
});

describe('Shadow DOM (SmartRecruiters web components)', () => {
  it('detects, labels and fills inputs inside open shadow roots', async () => {
    const host = document.createElement('spl-input');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<label for="first-name-input">First name*</label><input id="first-name-input" type="text">';
    const sel = document.createElement('spl-select');
    document.body.append(sel);
    sel.attachShadow({ mode: 'open' }).innerHTML =
      '<label id="q-label">Will you require visa sponsorship?</label><button role="combobox" aria-haspopup="listbox" aria-labelledby="q-label" aria-controls="q-menu">Select</button><div role="listbox" id="q-menu" hidden></div>';
    const fields = detectFields(document, { url: 'https://jobs.smartrecruiters.com/oneclick-ui/company/X/publication/1' });
    const first = byLabel(fields, /^First name$/);
    expect(first.fieldType).toBe('firstName');
    expect(elementsFor(document, first)).toHaveLength(1);
    expect(await fillField(document, first, 'Sam')).toMatchObject({ ok: true });
    expect(root.querySelector('input')!.value).toBe('Sam');
    expect(byLabel(fields, /sponsorship/)).toMatchObject({ kind: 'select', widget: 'listbox', fieldType: 'sponsorship' });
  });
});

describe('Zoho Recruit (Lyte/Crux components, markup from the live form)', () => {
  it('labels from cx-prop-label, not the shared label row, and separates the dial-code dropdown', () => {
    document.body.innerHTML = `
      <div class="crc-form-label-row">First Name *</div>
      <div class="crc-form-field">
        <crux-picklist-component cx-prop-label="Salutation" cx-prop-zcqa="manual_Salutation"><div class="lyteDummyEventContainer" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="Salutation" tabindex="0"><span class="lyteDropPlaceholderNormal">-None-</span></div></crux-picklist-component>
        <crux-text-component cx-prop-label="First Name" cx-prop-zcqa="manual_First_Name"><input type="text" class="cxBorderBottom" name="rec-form_1542" autocomplete="false"></crux-text-component>
      </div>
      <div class="crc-form-label-row">Phone Number</div>
      <crux-phone-component cx-prop-label="Phone Number" cx-prop-zcqa="manual_Mobile">
        <div class="lyteDummyEventContainer" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="Lyte_Drop_Body_0" tabindex="0">-None-</div>
        <input type="text" class="cxBorderBottom" name="rec-form_1554">
      </crux-phone-component>`;
    const fields = detectFields(document, { url: 'https://acme.zohorecruit.com/jobs/Careers/1/Engineer' });
    expect(pickAdapter('https://acme.zohorecruit.com/jobs/Careers/1/Engineer', document).name).toBe('zohorecruit');
    expect(byLabel(fields, /^Salutation$/)).toMatchObject({ kind: 'select', widget: 'listbox', fieldType: 'question', currentValue: '' });
    expect(byLabel(fields, /^First Name$/).fieldType).toBe('firstName');
    expect(byLabel(fields, /^Phone country code$/).fieldType).toBe('phoneCountryCode');
    const p = plan(fields);
    expect(p.find((i) => i.label === 'Phone Number')?.value).toBe('415 555 0100');
  });
});

describe('Oracle Recruiting Cloud (Candidate Experience)', () => {
  const html = `
    <div class="apply-flow"><form>
      <section><h2>Contact Information</h2>
        <div class="input-row"><label class="input-row__label" for="firstName-2">First Name</label><input class="input-row__control" id="firstName-2" name="firstName"></div>
        <div class="input-row honey-pot"><label for="honey-pot-1">honeypot</label><input class="input-row__control" id="honey-pot-1" name="honey-pot"></div>
        <div class="input-row"><label id="state-label" for="state-8">State</label><input class="input-row__control" id="state-8" role="combobox" readonly aria-haspopup="listbox" aria-labelledby="state-label" value=""></div>
      </section>
      <section><h2>E-Signature</h2>
        <div class="input-row"><label class="input-row__label" for="esign-12">Full Name</label><input class="input-row__control" id="esign-12" name="fullName"></div>
      </section>
    </form></div>`;
  it('treats read-only JET comboboxes as dropdowns, skips the honeypot and never signs', () => {
    document.body.innerHTML = html;
    const url = 'https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/1/apply';
    const fields = detectFields(document, { url });
    expect(pickAdapter(url, document).name).toBe('oraclecloud');
    expect(fields.some((f) => /honeypot/i.test(f.label))).toBe(false);
    expect(byLabel(fields, /^State$/)).toMatchObject({ kind: 'select', widget: 'listbox', fieldType: 'state' });
    const esign = byLabel(fields, /^Full Name$/);
    expect(esign.consent).toBe(true);
    expect(plan(fields).find((i) => i.fieldId === esign.id)?.status).toBe('manual');
  });
});

describe('Kula (Chakra UI, labels whose for= points nowhere)', () => {
  const html = `
    <form data-testid="job-form">
      <div class="chakra-form-control" role="group"><label for="field-_r_1_">First name*</label>
        <div class="w-full"><div class="job-form-kula-field"><div data-kui-field="true"><input id="info.first_name" name="info.first_name" placeholder="Enter first name"></div></div></div></div>
      <div class="chakra-form-control" role="group"><label for="phone">Phone*</label>
        <div><button type="button" aria-haspopup="listbox" aria-label="Select country. Currently India">+91</button><input id="phone" type="tel"></div></div>
      <div class="chakra-form-control" role="group"><label for="field-_r_2u_">Are you legally authorized to work in the United States?</label>
        <div role="radiogroup"><label><input type="radio" name="radio-_r_2v_" value="Yes"><span>Yes</span></label><label><input type="radio" name="radio-_r_2v_" value="No"><span>No</span></label></div></div>
    </form>`;
  it('uses the dangling label, and keeps +1 on the number while the country stays at its India default', () => {
    document.body.innerHTML = html;
    const fields = detectFields(document, { url: 'https://careers.kula.ai/acme/1-sdet/apply/' });
    expect(fields[0].adapter).toBe('kula');
    expect(byLabel(fields, /^First name$/).fieldType).toBe('firstName');
    expect(byLabel(fields, /legally authorized/)).toMatchObject({ kind: 'radio', fieldType: 'workAuthorization' });
    const p = plan(fields);
    expect(p.find((i) => i.fieldType === 'phoneCountryCode')?.status).toBe('prefilled');
    expect(p.find((i) => i.fieldType === 'phone')?.value).toBe('+1 415 555 0100');
  });
});

describe('Keka (select2 over hidden selects)', () => {
  const html = `
    <form>
      <label for="mobilePhone.number">Mobile Phone</label>
      <div class="input-group">
        <select name="mobilePhone.countryCode" class="select2-hidden-accessible" aria-hidden="true"><option value="">Select</option><option>+1-684</option><option>+1</option><option>+91</option></select>
        <span class="select2 select2-container"><span class="select2-selection" role="combobox" aria-haspopup="true">Select</span></span>
        <input type="text" name="mobilePhone.number" id="mobilePhone.number">
      </div>
      <div><input type="checkbox" name="candidateConsent" id="candidateConsent"><span>I agree to the processing of my personal data.</span></div>
    </form>`;
  it('fills the select behind select2 (not the look-alike), picks +1 not +1-684, and never ticks consent', () => {
    document.body.innerHTML = html;
    const fields = detectFields(document, { url: 'https://acme.keka.com/careers/applyjob/1' });
    expect(fields.filter((f) => f.widget === 'listbox')).toHaveLength(0);
    const code = fields.find((f) => f.name === 'mobilePhone.countryCode')!;
    expect(code).toMatchObject({ kind: 'select', fieldType: 'phoneCountryCode' });
    const p = plan(fields);
    expect(p.find((i) => i.fieldId === code.id)).toMatchObject({ status: 'ready', value: '+1' });
    expect(p.find((i) => i.fieldType === 'phone')?.value).toBe('415 555 0100');
    const consent = byLabel(fields, /I agree/);
    expect(consent.consent).toBe(true);
    expect(p.find((i) => i.fieldId === consent.id)?.status).toBe('manual');
  });
});

describe('Teamtailor, Rippling, Recruitee, Breezy, Personio replicas', () => {
  it('Teamtailor: strips the hidden "Required" from labels and leaves consent boxes alone', () => {
    const url = load('teamtailor.html');
    const fields = detectFields(document, { url });
    expect(fields[0].adapter).toBe('teamtailor');
    expect(fields.map((f) => f.label)).toEqual(expect.arrayContaining(['First name', 'Upload CV', 'Cover letter']));
    expect(fields.some((f) => /Required/.test(f.label))).toBe(false);
    expect(byLabel(fields, /Lawful Worker/)).toMatchObject({ fieldType: 'workAuthorization' });
    expect(fields.filter((f) => f.consent)).toHaveLength(2);
  });

  it('Rippling: finds the question for "Select" dropdowns and treats the SMS opt-in as consent', () => {
    const url = load('rippling.html');
    const fields = detectFields(document, { url });
    expect(fields[0].adapter).toBe('rippling');
    expect(fields.some((f) => f.label === 'Select')).toBe(false);
    expect(byLabel(fields, /legally authorized/)).toMatchObject({ widget: 'listbox', fieldType: 'workAuthorization' });
    expect(byLabel(fields, /commute/).fieldType).toBe('question');
    expect(byLabel(fields, /text messages/)).toMatchObject({ kind: 'radio', consent: true });
    expect(extractJobInfo(document, url).title).toBe('Platform Engineer');
  });

  it('Recruitee: a phone box pre-typed with "+31" is empty, and the calling-code button is the country code', () => {
    const url = load('recruitee.html');
    const fields = detectFields(document, { url });
    expect(fields[0].adapter).toBe('recruitee');
    expect(byLabel(fields, /calling code/).fieldType).toBe('phoneCountryCode');
    const phone = byLabel(fields, /^Phone number$/);
    expect(phone.currentValue).toBe('');
    expect(plan(fields).find((i) => i.fieldId === phone.id)).toMatchObject({ status: 'ready', value: '+1 415 555 0100' }); // country stays NL by default
  });

  it('Breezy: keeps the pre-selected currency/period and never ticks the SMS consent', () => {
    const url = load('breezy.html');
    const fields = detectFields(document, { url });
    expect(fields[0].adapter).toBe('breezy');
    expect(byLabel(fields, /text messages/).consent).toBe(true);
    const p = plan(fields);
    expect(p.filter((i) => i.fieldType === 'desiredSalary' && i.kind === 'select').every((i) => i.status === 'prefilled')).toBe(true);
    expect(extractJobInfo(document, url)).toMatchObject({ title: 'Platform Engineer', company: 'Initech' });
  });

  it('Personio: answers authorization for listed countries only — Germany is asked, not answered "No"', () => {
    const url = load('personio.html');
    const fields = detectFields(document, { url });
    expect(fields[0].adapter).toBe('personio');
    const p = plan(fields);
    expect(p.find((i) => /United States\?/.test(i.label))).toMatchObject({ status: 'ready', value: 'Yes' });
    expect(p.find((i) => /Germany\?/.test(i.label))).toMatchObject({ status: 'unknown', value: '' });
    expect(byLabel(fields, /privacy policy/).consent).toBe(true);
  });
});

describe('Single checkboxes are yes/no questions', () => {
  it('does not treat "Record my email address" as the email field', () => {
    document.body.innerHTML = '<div role="checkbox" aria-checked="false" aria-label="Record my email address with my response" tabindex="0"></div>';
    const [f] = detectFields(document, { url: 'https://docs.google.com/forms/d/e/x/viewform' });
    expect(f).toMatchObject({ kind: 'checkbox', fieldType: 'question' });
    expect(plan([f])[0].status).toBe('unknown');
  });
});

describe('Phone with a separate country-code dropdown (LinkedIn)', () => {
  it('picks "United States (+1)" and fills the national number', () => {
    document.body.innerHTML = `
      <label for="cc">Phone country code</label><select id="cc"><option value="Select an option">Select an option</option><option>Canada (+1)</option><option>United States (+1)</option><option>India (+91)</option></select>
      <label for="ph">Mobile phone number</label><input id="ph" type="text">`;
    const fields = detectFields(document, { url: 'https://www.linkedin.com/jobs/view/1' });
    const p = plan(fields);
    expect(p.find((i) => i.fieldType === 'phoneCountryCode')).toMatchObject({ status: 'ready', value: 'United States (+1)' });
    expect(p.find((i) => i.fieldType === 'phone')?.value).toBe('415 555 0100');
    expect(fields.find((f) => f.fieldType === 'phoneCountryCode')?.currentValue).toBe(''); // "Select an option" is a placeholder
  });
});
