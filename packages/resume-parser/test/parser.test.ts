import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { AppError } from '@pingx969/shared';
import { detectFormat, extractText, importResumeJson, parseEntryHeader, parseResume, segmentResume, isLocation } from '../src';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/resumes');
const load = (f: string) => new Uint8Array(fs.readFileSync(path.join(dir, f)));

describe('parseResume across formats', () => {
  for (const f of ['jane-doe.docx', 'jane-doe.pdf', 'jane-doe.txt', 'jane-doe.md', 'jane-doe.json']) {
    it(`parses ${f} into the same structure`, async () => {
      const r = await parseResume(load(f), f);
      const d = r.data;
      expect(d.personal).toMatchObject({ name: 'Jane Doe', firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '(206) 555-0142' });
      expect(d.experience.map((e) => [e.title, e.company, e.startDate, e.endDate])).toEqual([
        ['Senior Software Engineer', 'Northwind Commerce', '2021-03', 'present'],
        ['Software Engineer', 'Contoso Health', '2018-06', '2021-02'],
      ]);
      expect(d.experience[0].bullets[0].text).toBe('Built backend services for internal applications.');
      expect(d.experience[0].technologies).toEqual(expect.arrayContaining(['Python', 'Flask', 'Docker']));
      expect(d.education[0]).toMatchObject({ institution: 'University of Washington', degree: 'B.S.', field: 'Computer Science' });
      expect(d.skills.flatMap((g) => g.items)).toEqual(expect.arrayContaining(['Python', 'TypeScript', 'AWS', 'PostgreSQL']));
      expect(d.summary.text).toMatch(/^Software engineer with 8 years/);
      expect(d.links.find((l) => l.kind === 'linkedin')?.url).toBe('https://linkedin.com/in/janedoe');
      // every bullet points back to a source line
      if (!f.endsWith('.json')) for (const b of d.experience.flatMap((e) => e.bullets)) expect(r.document.lines[b.line!].text).toContain(b.text.slice(0, 20));
    });
  }

  it('extracts layout from DOCX (fonts, sizes, margins, heading style)', async () => {
    const r = await parseResume(load('jane-doe.docx'), 'jane-doe.docx');
    expect(r.document.layout).toMatchObject({ fontNameHint: 'Calibri', fontFamily: 'sans', nameSize: 22, nameAlign: 'center', headingRule: true, headingUppercase: true, bulletGlyph: '•', nameUppercase: true });
    expect(r.document.layout.margins.left).toBeCloseTo(43.2);
    expect(r.document.lines.filter((l) => l.bullet).length).toBe(10);
  });

  it('extracts layout from PDF and merges wrapped bullet lines', async () => {
    const r = await parseResume(load('jane-doe.pdf'), 'jane-doe.pdf');
    expect(r.document.layout).toMatchObject({ pageWidth: 612, pageHeight: 792, nameAlign: 'center', headingRule: true, bodySize: 10, fontFamily: 'sans' });
    const wrapped = r.data.experience[0].bullets.find((b) => b.text.startsWith('Worked on containerizing'))!;
    expect(wrapped.text).toBe('Worked on containerizing services with Docker and setting up CI/CD with GitHub Actions for 12 services across three product teams.');
    expect(r.document.lines[wrapped.line!].span).toBe(2);
  });

  it('reads a two-column PDF column by column', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([612, 792]);
    const f = await pdf.embedFont(StandardFonts.Helvetica);
    const b = await pdf.embedFont(StandardFonts.HelveticaBold);
    let y = 740;
    page.drawText('ALEX KIM', { x: 40, y: 760, size: 18, font: b });
    const left = ['SKILLS', 'Python, Go', 'Kubernetes', 'CONTACT', 'alex@example.com', '(555) 123-4567', 'Denver, CO'];
    const right = ['EXPERIENCE', 'Platform Engineer | Acme Labs', 'Jan 2020 – Present', '• Ran Kubernetes clusters for 40 services across regions.', '• Built Go tooling for deployments and on-call automation.', 'EDUCATION', 'Colorado State University | B.S., Computer Science | 2015 – 2019'];
    for (let i = 0; i < 7; i++) {
      page.drawText(left[i], { x: 40, y, size: 10, font: /^[A-Z]+$/.test(left[i]) ? b : f });
      page.drawText(right[i], { x: 230, y, size: 10, font: /^[A-Z]+$/.test(right[i]) ? b : f });
      y -= 16;
    }
    const r = await parseResume(await pdf.save(), 'two-col.pdf');
    expect(r.document.structure.multiColumn).toBe(true);
    expect(r.data.experience[0]).toMatchObject({ title: 'Platform Engineer', company: 'Acme Labs', startDate: '2020-01' });
    expect(r.data.personal.email).toBe('alex@example.com');
  });
});

describe('designed / table-style PDFs', () => {
  it('reads letter-spaced names, table rows, label|items skills with wrapped rows and dot bullets', async () => {
    const r = await parseResume(load('alex-table.pdf'), 'alex-table.pdf');
    expect(r.data.personal).toMatchObject({ name: 'Alex Rivera', email: 'alex.rivera@example.com', phone: '+91-9000000000', location: 'Pune, Maharashtra, India' });
    expect(r.data.skills.map((g) => g.category)).toEqual(['Programming Languages', 'Databases', 'Other']);
    expect(r.data.skills[0].items).toEqual(expect.arrayContaining(['Go', 'Express.js', 'Flask']));
    expect(r.data.skills[2].items).toContain('Low Level Design (LLD)'); // item wrapped across two lines
    expect(r.data.skills[2].lines).toHaveLength(2);
    expect(r.data.education.map((e) => [e.degree, e.field, e.institution, e.endDate])).toEqual([
      ['Bachelor of Technology', 'Computer Science', 'IIT Bombay', '2019'],
      ['HSC', 'Science', 'Fergusson College', '2015'],
    ]);
    expect(r.data.experience[0]).toMatchObject({ title: 'Senior Software Engineer', company: 'Initech', location: 'Pune, Maharashtra' });
    expect(r.data.experience[0].bullets.map((b) => b.text)).toEqual([
      'Built Go and Kafka services that process payment events for 4M merchants with exactly-once delivery and automated reconciliation.',
      'Led the migration of batch jobs from cron to Airflow on Kubernetes, cutting failures by 60%.',
      'Designed GraphQL APIs backed by PostgreSQL and Redis for the merchant dashboard.',
    ]);
    expect(r.parserVersion).toBeGreaterThanOrEqual(2);
  });
});

describe('errors', () => {
  it('rejects corrupted, empty, unsupported and legacy files with clear errors', async () => {
    await expect(parseResume(load('corrupted.pdf'), 'x.pdf')).rejects.toMatchObject({ code: 'corrupted_file' });
    await expect(parseResume(new Uint8Array(), 'x.pdf')).rejects.toMatchObject({ code: 'empty_resume' });
    await expect(parseResume(load('not-a-resume.exe'), 'x.exe')).rejects.toBeInstanceOf(AppError);
    await expect(parseResume(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]), 'old.doc')).rejects.toMatchObject({ message: expect.stringMatching(/Legacy Word/) });
    await expect(parseResume(new TextEncoder().encode('hi'), 'x.txt')).rejects.toMatchObject({ code: 'empty_resume' });
    await expect(parseResume(new TextEncoder().encode('{not json'), 'x.json')).rejects.toMatchObject({ code: 'corrupted_file' });
    // A zip that isn't a docx
    await expect(parseResume(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]), 'x.docx')).rejects.toMatchObject({ code: 'corrupted_file' });
  });

  it('detects the real format from magic bytes, not the extension', () => {
    expect(detectFormat(load('jane-doe.pdf'), 'resume.txt')).toBe('pdf');
    expect(detectFormat(load('jane-doe.docx'), 'resume.docx')).toBe('docx');
    expect(() => detectFormat(load('not-a-resume.exe'), 'resume.pdf')).toThrow(/Unsupported/);
  });
});

describe('segmentation details', () => {
  it('parses varied entry headers', () => {
    expect(parseEntryHeader(['Software Engineer at Google', 'Mountain View, CA | 2019 – 2021'])).toMatchObject({ title: 'Software Engineer', company: 'Google', location: 'Mountain View, CA', startDate: '2019', endDate: '2021' });
    expect(parseEntryHeader(['Stripe — Staff Engineer — Remote — Sep 2022 – Present'])).toMatchObject({ title: 'Staff Engineer', company: 'Stripe', location: 'Remote', endDate: 'present' });
    expect(parseEntryHeader(['Acme Labs, Austin, TX', 'Data Analyst', 'June 2017 - May 2019'])).toMatchObject({ title: 'Data Analyst', company: 'Acme Labs', location: 'Austin, TX', startDate: '2017-06', endDate: '2019-05' });
  });

  it('recognizes locations', () => {
    expect(isLocation('Seattle, WA')).toBe(true);
    expect(isLocation('Berlin, Germany')).toBe(true);
    expect(isLocation('Remote')).toBe(true);
    expect(isLocation('Python, Go')).toBe(false);
  });

  it('handles multiple roles at one company and paragraph-style descriptions', () => {
    const text = `JOHN SMITH\njohn@example.com\n\nEXPERIENCE\nGlobex Corp — Chicago, IL\nSenior Engineer   2021 – Present\n• Led the payments team of 5 engineers.\nEngineer   2018 – 2021\nBuilt the first version of the billing system using Java and Spring Boot.\n\nSKILLS\nJava; Spring Boot; Kafka\n`;
    const { data } = segmentResume(extractText(text, 'txt'));
    expect(data.experience.map((e) => [e.title, e.company])).toEqual([
      ['Senior Engineer', 'Globex Corp'],
      ['Engineer', 'Globex Corp'],
    ]);
    expect(data.experience[1].bullets[0].text).toMatch(/^Built the first version/);
    expect(data.skills[0]).toMatchObject({ items: ['Java', 'Spring Boot', 'Kafka'], delimiter: '; ' });
  });

  it('imports JSON Resume', () => {
    const { data, flavor } = importResumeJson(fs.readFileSync(path.join(dir, 'jane-doe.json'), 'utf8'));
    expect(flavor).toBe('jsonresume');
    expect(data.experience[0]).toMatchObject({ company: 'Northwind Commerce', startDate: '2021-03', endDate: 'present' });
  });
});
