import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { type ResumeData } from '@pingx969/shared';
import { parseResume } from '@pingx969/resume-parser';
import { computeEdits, exportCapabilities, exportResume, patchDocx, patchText, renderPdf, toJsonResume } from '../src';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/resumes');
const bytesOf = (f: string) => new Uint8Array(fs.readFileSync(path.join(dir, f)));

function edit(data: ResumeData): ResumeData {
  const d: ResumeData = structuredClone(data);
  d.summary.text = 'Senior Software Engineer with 8+ years of experience building backend services using Python and AWS.';
  d.experience[0].bullets[0].text = 'Built Python backend services for internal applications.';
  d.experience[0].bullets = [d.experience[0].bullets[1], d.experience[0].bullets[0], ...d.experience[0].bullets.slice(2)];
  d.skills[0].items = ['Python', 'SQL', 'JavaScript', 'TypeScript'];
  d.skills[2].items = [...d.skills[2].items, 'AWS Lambda'];
  return d;
}

describe('DOCX export (format preservation)', () => {
  it('patches only changed text; styles, numbering and formatting stay identical', async () => {
    const src = bytesOf('jane-doe.docx');
    const parsed = await parseResume(src, 'a.docx');
    const { bytes, warnings } = await patchDocx(src, parsed.document, parsed.data, edit(parsed.data));
    expect(warnings).toEqual([]);
    const [a, b] = await Promise.all([JSZip.loadAsync(src), JSZip.loadAsync(bytes)]);
    expect(Object.keys(b.files).sort()).toEqual(Object.keys(a.files).sort());
    for (const name of Object.keys(a.files).filter((n) => n !== 'word/document.xml' && !a.files[n].dir)) {
      expect(await b.file(name)!.async('string'), name).toBe(await a.file(name)!.async('string'));
    }
    const xml = await b.file('word/document.xml')!.async('string');
    // the bold "Languages: " label run is preserved; only the item run changed
    expect(xml).toContain('<w:t xml:space="preserve">Languages: </w:t></w:r><w:r><w:t xml:space="preserve">Python, SQL, JavaScript, TypeScript</w:t>');
    const back = await parseResume(bytes, 'b.docx');
    expect(back.data.experience[0].bullets.map((x) => x.text).slice(0, 2)).toEqual([
      'Designed REST APIs in Python and Flask serving 2M requests per day.',
      'Built Python backend services for internal applications.',
    ]);
    // reordered bullets kept their list numbering
    expect(back.document.lines.filter((l) => l.bullet)).toHaveLength(10);
    expect(back.data.summary.text).toMatch(/^Senior Software Engineer with 8\+/);
    expect(back.data.skills[2].items).toContain('AWS Lambda');
  });

  it('inserts a summary section using the document’s own heading and body styles', async () => {
    const doc = new Document({
      styles: { default: { document: { run: { font: 'Georgia', size: 22 } } } },
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun({ text: 'Sam Lee', bold: true, size: 36 })] }),
            new Paragraph({ children: [new TextRun('sam@example.com | (555) 010-2000')] }),
            new Paragraph({ children: [new TextRun({ text: 'Experience', bold: true, size: 26 })] }),
            new Paragraph({ children: [new TextRun({ text: 'Engineer | Acme | 2019 – Present', bold: true })] }),
            new Paragraph({ children: [new TextRun('• Built internal tools in Python for the finance team.')] }),
            new Paragraph({ children: [new TextRun({ text: 'Skills', bold: true, size: 26 })] }),
            new Paragraph({ children: [new TextRun('Python, SQL, Docker and a long list of other tools I use regularly at work')] }),
          ],
        },
      ],
    });
    const src = new Uint8Array(await Packer.toBuffer(doc));
    const parsed = await parseResume(src, 'sam.docx');
    expect(parsed.data.summary.text).toBe('');
    const next = structuredClone(parsed.data);
    next.summary.text = 'Engineer with 7+ years of experience building internal tools using Python.';
    const out = await patchDocx(src, parsed.document, parsed.data, next);
    const back = await parseResume(out.bytes, 'sam2.docx');
    expect(back.data.summary.text).toBe(next.summary.text);
    expect(back.data.headings.map((h) => h.section)).toEqual(['summary', 'experience', 'skills']);
    const xml = await (await JSZip.loadAsync(out.bytes)).file('word/document.xml')!.async('string');
    expect(xml).toMatch(/<w:b\/>.*?<w:t xml:space="preserve">Summary<\/w:t>/s);
  });
});

describe('text export', () => {
  it('rewrites only changed lines of a TXT resume', async () => {
    const src = bytesOf('jane-doe.txt');
    const original = Buffer.from(src).toString('utf8');
    const parsed = await parseResume(src, 'a.txt');
    const { text } = patchText(original, parsed.document, parsed.data, edit(parsed.data));
    const a = original.split('\n');
    const b = text.split('\n');
    expect(b.length).toBe(a.length);
    const changed = a.map((l, i) => (l !== b[i] ? i : -1)).filter((i) => i >= 0);
    expect(changed.length).toBeLessThanOrEqual(6); // summary, 2 bullet slots, 2 skills lines
    expect(text).toContain('• Built Python backend services for internal applications.');
    expect(text).toContain('Languages: Python, SQL, JavaScript, TypeScript');
  });

  it('keeps markdown syntax intact', async () => {
    const src = bytesOf('jane-doe.md');
    const parsed = await parseResume(src, 'a.md');
    const res = await exportResume({ format: 'md', source: parsed, sourceFormat: 'md', originalBytes: src, optimized: edit(parsed.data) });
    const md = Buffer.from(res.bytes).toString('utf8');
    expect(res.fidelity).toBe('original-patched');
    expect(md).toContain('## Experience');
    expect(md).toContain('**Senior Software Engineer** | Northwind Commerce');
    expect(md).toContain('- Built Python backend services for internal applications.');
  });
});

describe('PDF and other exports', () => {
  it('re-renders a PDF with the original layout profile and handles non-Latin text', async () => {
    const parsed = await parseResume(bytesOf('jane-doe.pdf'), 'a.pdf');
    const d = edit(parsed.data);
    d.experience[1].bullets[0].text = 'Developed features → shipped to 10 clinics (naïve café ✓ 北京)';
    const pdf = await renderPdf(d, parsed.document.layout);
    const back = await parseResume(pdf, 'b.pdf');
    expect(back.document.layout).toMatchObject({ pageWidth: 612, nameAlign: 'center', headingRule: true, headingUppercase: true });
    expect(back.data.experience[0].bullets[1].text).toBe('Built Python backend services for internal applications.');
    expect(back.rawText).toContain('->');
  });

  it('paginates long resumes', async () => {
    const parsed = await parseResume(bytesOf('jane-doe.txt'), 'a.txt');
    const d = structuredClone(parsed.data);
    for (let i = 0; i < 6; i++) d.experience.push({ ...structuredClone(d.experience[0]), id: `x${i}` });
    const back = await parseResume(await renderPdf(d, parsed.document.layout), 'long.pdf');
    expect(back.document.structure.pageCount).toBeGreaterThan(1);
  });

  it('describes capabilities per source format and exports JSON', async () => {
    expect(exportCapabilities('docx').find((c) => c.format === 'docx')!.fidelity).toBe('original-patched');
    expect(exportCapabilities('pdf').find((c) => c.format === 'docx')!.fidelity).toBe('layout-matched');
    const parsed = await parseResume(bytesOf('jane-doe.docx'), 'a.docx');
    const json = JSON.parse(Buffer.from((await exportResume({ format: 'json', source: parsed, sourceFormat: 'docx', originalBytes: null, optimized: parsed.data })).bytes).toString('utf8'));
    expect(json.resume.experience[0].bullets).toHaveLength(5);
    expect(json.resume.experience[0].line).toBeUndefined();
    expect(toJsonResume(parsed.data).work[0].name).toBe('Northwind Commerce');
  });

  it('computes edits against source lines', async () => {
    const parsed = await parseResume(bytesOf('jane-doe.docx'), 'a.docx');
    const e = computeEdits(parsed.data, edit(parsed.data));
    expect(e).toMatchObject({ bulletText: [{ oldText: 'Built backend services for internal applications.' }], summaryInsert: null });
    expect(e.reorders).toHaveLength(1);
    expect(e.skills).toHaveLength(2);
  });
});
