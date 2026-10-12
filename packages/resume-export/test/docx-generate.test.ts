/**
 * DOCX generated from scratch (used when the original isn't a Word file): valid OOXML, every section and
 * fact present, the original's layout applied, and the result parses back to the same resume.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ParsedResume } from '@pingx969/shared';
import { parseResume } from '@pingx969/resume-parser';
import { exportResume, generateDocx } from '../src';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures');
let fromPdf: ParsedResume;

beforeAll(async () => {
  fromPdf = await parseResume(new Uint8Array(fs.readFileSync(path.join(root, 'resumes/jane-doe.pdf'))), 'jane-doe.pdf');
});

const documentXml = async (bytes: Uint8Array) => (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');

describe('generateDocx', () => {
  it('produces a valid Word package containing every section and fact', async () => {
    const bytes = await generateDocx(fromPdf.data, fromPdf.document.layout);
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(['[Content_Types].xml', 'word/document.xml']));
    const xml = await documentXml(bytes);
    const d = fromPdf.data;
    expect(xml.toLowerCase()).toContain(d.personal.name.toLowerCase()); // may be uppercased, as in the original layout
    expect(xml).toContain(d.personal.email);
    for (const e of d.experience) {
      expect(xml).toContain(e.company);
      for (const b of e.bullets.slice(0, 2)) expect(xml).toContain(b.text.slice(0, 30).replace(/&/g, '&amp;'));
    }
    for (const g of d.skills) expect(xml).toContain(g.items[0]);
    expect(xml).toContain(d.education[0].institution);
  });

  it('round-trips: the generated DOCX parses back to the same resume', async () => {
    const reparsed = await parseResume(await generateDocx(fromPdf.data, fromPdf.document.layout), 'generated.docx');
    expect(reparsed.data.personal.name.toLowerCase()).toBe(fromPdf.data.personal.name.toLowerCase());
    expect(reparsed.data.personal.email).toBe(fromPdf.data.personal.email);
    expect(reparsed.data.experience.map((e) => e.company)).toEqual(fromPdf.data.experience.map((e) => e.company));
    expect(reparsed.data.experience[0].bullets).toHaveLength(fromPdf.data.experience[0].bullets.length);
    expect(reparsed.data.skills.flatMap((g) => g.items).sort()).toEqual(fromPdf.data.skills.flatMap((g) => g.items).sort());
  });

  it('applies the layout profile (page size and body font) and works without one', async () => {
    const letter = await documentXml(await generateDocx(fromPdf.data, { ...fromPdf.document.layout, pageWidth: 612, pageHeight: 792 }));
    expect(letter).toMatch(/w:pgSz[^>]*w:w="12240"/); // 8.5in in twentieths of a point
    const a4 = await documentXml(await generateDocx(fromPdf.data, { ...fromPdf.document.layout, pageWidth: 595.3, pageHeight: 841.9 }));
    expect(a4).toMatch(/w:pgSz[^>]*w:w="1190\d"/);
    expect((await generateDocx(fromPdf.data)).length).toBeGreaterThan(1000);
  });

  it('is what exportResume uses for a DOCX export of a non-Word original', async () => {
    const out = await exportResume({ format: 'docx', source: fromPdf, sourceFormat: 'pdf', originalBytes: null, optimized: fromPdf.data, title: 'Test' });
    expect(out).toMatchObject({ extension: 'docx', fidelity: 'layout-matched' });
    expect((await documentXml(out.bytes)).toLowerCase()).toContain(fromPdf.data.personal.name.toLowerCase());
  });
});
