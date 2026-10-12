import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { parseResume } from '@pingx969/resume-parser';
import { appendSkillsInPlace, appendedSkills, exportResume } from '../src';
import { filterTextByBaseline } from '../src/pdf-content-filter';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/resumes');
const bytes = () => new Uint8Array(fs.readFileSync(path.join(dir, 'alex-table.pdf')));
const ADDED = ['Databricks', 'Delta Lake', 'Dagster', 'Terraform', 'Datadog', 'Domain-Driven Design', 'Data Modeling', 'Serverless', 'TDD', 'Prometheus', 'OpenTelemetry', 'Snowflake'];

async function appendCase() {
  const src = bytes();
  const parsed = await parseResume(src, 'alex.pdf');
  const optimized = structuredClone(parsed.data);
  optimized.skills.at(-1)!.items.push(...ADDED);
  return { src, parsed, optimized };
}

describe('in-place PDF skills append', () => {
  it('keeps every original line exactly once and appends the skills to the last skills row', async () => {
    const { src, parsed, optimized } = await appendCase();
    const res = (await appendSkillsInPlace(src, parsed.document, parsed.data, optimized))!;
    expect(res).not.toBeNull();
    const back = await parseResume(res.bytes, 'out.pdf');
    // ATS safety: no hidden duplicate text from the clipped slices
    const occurrences = (hay: string, needle: string) => hay.replace(/\s+/g, ' ').split(needle).length - 1;
    for (const l of parsed.document.lines.filter((x) => x.text.length > 15)) {
      const needle = l.text.replace(/\s+/g, ' ').slice(0, 45);
      expect(occurrences(back.rawText, needle), `"${needle}"`).toBe(occurrences(parsed.rawText, needle));
    }
    const other = back.data.skills.find((g) => g.category === 'Other')!;
    expect(other.items.slice(-ADDED.length)).toEqual(ADDED);
    expect(other.items.slice(0, -ADDED.length)).toEqual(parsed.data.skills.at(-1)!.items);
    // Everything else is unchanged
    expect(back.data.personal).toMatchObject({ name: 'Alex Rivera', email: 'alex.rivera@example.com' });
    expect(back.data.education).toEqual(parsed.data.education.map((e) => ({ ...e, lines: expect.any(Array) })));
    expect(back.data.experience.map((e) => [e.title, e.company, e.bullets.map((b) => b.text)])).toEqual(parsed.data.experience.map((e) => [e.title, e.company, e.bullets.map((b) => b.text)]));
    expect(back.data.projects.map((p) => p.name)).toEqual(parsed.data.projects.map((p) => p.name));
  });

  it('shifts content below the insertion, flowing across pages without splitting lines', async () => {
    const { src, parsed, optimized } = await appendCase();
    const res = (await appendSkillsInPlace(src, parsed.document, parsed.data, optimized))!;
    const back = await parseResume(res.bytes, 'out.pdf');
    const yOf = (doc: typeof parsed.document, t: string) => doc.lines.find((l) => l.text.startsWith(t))!;
    // The heading after Skills moved down by the inserted lines
    const before = yOf(parsed.document, 'WORK EXPERIENCE');
    const after = yOf(back.document, 'WORK EXPERIENCE');
    expect(after.page).toBe(before.page);
    expect(after.y! - before.y!).toBeGreaterThan(9);
    // Lines above the insertion did not move
    expect(yOf(back.document, 'EDUCATION').y).toBeCloseTo(yOf(parsed.document, 'EDUCATION').y!, 1);
    // Pushed-down content continues on page 2 before the original page-2 content
    const p2 = back.document.lines.filter((l) => l.page === 1).map((l) => l.text);
    expect(p2.indexOf('PROJECTS')).toBeGreaterThan(0);
    expect(back.document.structure.pageCount).toBe(parsed.document.structure.pageCount);
  });

  it('carries clickable links over and keeps document metadata', async () => {
    const { src, parsed, optimized } = await appendCase();
    const res = (await appendSkillsInPlace(src, parsed.document, parsed.data, optimized))!;
    const doc = await PDFDocument.load(res.bytes);
    expect(doc.getTitle()).toBe('Alex Rivera Resume');
    const annots = doc.getPage(0).node.Annots() as PDFArray;
    const uris = annots.asArray().map((r) => ((doc.context.lookup(r) as PDFDict).lookup(PDFName.of('A')) as PDFDict).lookup(PDFName.of('URI'))!.toString());
    expect(uris.join()).toContain('alexrivera.dev');
  });

  it('is only used for pure skills appends', async () => {
    const { parsed } = await appendCase();
    const reordered = structuredClone(parsed.data);
    reordered.skills[0].items.reverse();
    expect(appendedSkills(parsed.data, reordered)).toBeNull();
    const rephrased = structuredClone(parsed.data);
    rephrased.experience[0].bullets[0].text = 'Changed';
    expect(appendedSkills(parsed.data, rephrased)).toBeNull();
    expect(appendedSkills(parsed.data, parsed.data)).toEqual([]);
  });

  it('exportResume picks the in-place path for PDFs and re-renders otherwise', async () => {
    const { src, parsed, optimized } = await appendCase();
    const inPlace = await exportResume({ format: 'pdf', source: parsed, sourceFormat: 'pdf', originalBytes: src, optimized });
    expect(inPlace.fidelity).toBe('original-patched');
    const changed = structuredClone(optimized);
    changed.summary.text = 'New summary';
    const rendered = await exportResume({ format: 'pdf', source: parsed, sourceFormat: 'pdf', originalBytes: src, optimized: changed });
    expect(rendered.fidelity).toBe('layout-matched');
    expect(rendered.warnings.join(' ')).toMatch(/Skills only/);
  });
});

describe('content stream text filter', () => {
  it('drops text-show operators outside the band and keeps graphics and line moves', () => {
    const content = new TextEncoder().encode('q 1 0 0 1 0 0 cm BT /F1 9 Tf 12 TL 50 700 Td (top) Tj 0 -200 Td [(mid) 120 (dle)] TJ T* (next) \' ET 0 0 m 100 100 l S Q');
    const out = new TextDecoder().decode(filterTextByBaseline(content, (y) => y > 600));
    expect(out).toContain('(top) Tj');
    expect(out).not.toContain('(mid)');
    expect(out).not.toContain('(next)');
    expect(out).toContain('T*'); // the line advance of the removed ' operator is preserved
    expect(out).toContain('0 0 m 100 100 l S');
  });
});
