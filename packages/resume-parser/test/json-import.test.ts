/** JSON resume import: the JSON Resume schema, this app's own export format, and clear errors otherwise. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { importResumeJson } from '../src/extract-json';
import { parseResume } from '../src';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures');

const jsonResume = {
  basics: {
    name: 'Priya Sharma',
    label: 'Backend Engineer',
    email: 'priya@example.com',
    phone: '+91 98765 43210',
    url: 'https://priya.dev',
    summary: 'Backend engineer focused on payments.',
    location: { city: 'Pune', region: 'Maharashtra', countryCode: 'IN' },
    profiles: [{ network: 'LinkedIn', url: 'https://linkedin.com/in/priya' }, { network: 'GitHub', url: 'https://github.com/priya' }],
  },
  work: [
    { name: 'Initech', position: 'Senior Engineer', startDate: '2021-04-01', highlights: ['Built Go services for payments', 'Cut latency by 40%'] },
    { name: 'Globex', position: 'Engineer', startDate: '2018-07', endDate: '2021-03', summary: 'Owned the billing API.' },
  ],
  education: [{ institution: 'IIT Bombay', studyType: 'Bachelor of Technology', area: 'Computer Science', endDate: '2018' }],
  skills: [{ name: 'Languages', keywords: ['Go', 'Python'] }, { name: 'Cloud', keywords: ['AWS'] }],
  projects: [{ name: 'ledger', description: 'Double-entry ledger', highlights: ['Open source'], keywords: ['Go'] }],
  certificates: [{ name: 'AWS Solutions Architect', issuer: 'Amazon', date: '2022-01-10' }],
};

describe('importResumeJson', () => {
  it('maps the JSON Resume schema', () => {
    const { data, flavor } = importResumeJson(JSON.stringify(jsonResume));
    expect(flavor).toBe('jsonresume');
    expect(data.personal).toMatchObject({ name: 'Priya Sharma', email: 'priya@example.com', phone: '+91 98765 43210' });
    expect(data.links.map((l) => l.url)).toEqual(expect.arrayContaining(['https://linkedin.com/in/priya', 'https://github.com/priya']));
    expect(data.experience[0]).toMatchObject({ company: 'Initech', title: 'Senior Engineer', startDate: '2021-04', endDate: 'present' });
    expect(data.experience[0].bullets.map((b) => b.text)).toEqual(['Built Go services for payments', 'Cut latency by 40%']);
    expect(data.experience[1]).toMatchObject({ startDate: '2018-07', endDate: '2021-03' });
    expect(data.education[0]).toMatchObject({ institution: 'IIT Bombay', field: 'Computer Science' });
    expect(data.skills.flatMap((g) => g.items)).toEqual(['Go', 'Python', 'AWS']);
    expect(data.certifications[0].name).toBe('AWS Solutions Architect');
  });

  it("accepts this app's own export format and assigns missing ids", async () => {
    const own = JSON.parse(fs.readFileSync(path.join(root, 'resumes/jane-doe.json'), 'utf8'));
    const parsed = await parseResume(new Uint8Array(Buffer.from(JSON.stringify(own))), 'jane.json');
    const { data, flavor } = importResumeJson(JSON.stringify({ ...parsed.data, experience: parsed.data.experience.map(({ id: _id, ...e }) => e) }));
    expect(flavor).toBe('internal');
    expect(data.experience.every((e) => e.id)).toBe(true);
    expect(data.personal.name).toBe(parsed.data.personal.name);
  });

  it.each([
    ['{not json', /not valid JSON/],
    ['42', /does not contain a resume/],
    ['{"title":"Shopping list"}', /Unrecognized JSON resume format/],
    ['{"personal":{"name":123},"experience":"x"}', /does not match the expected structure/],
  ])('rejects %s with a clear message', (text, message) => {
    expect(() => importResumeJson(text)).toThrow(message);
  });
});
