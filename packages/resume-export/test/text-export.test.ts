/** In-place TXT export: Windows line endings, summary and skills edits, everything else byte-identical. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseResume } from '@pingx969/resume-parser';
import { patchText } from '../src';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures');

describe('patchText', () => {
  it('keeps CRLF line endings and untouched lines byte-identical while editing summary and skills', async () => {
    const crlf = fs.readFileSync(path.join(root, 'resumes/jane-doe.txt'), 'utf8').replace(/\r?\n/g, '\r\n');
    const parsed = await parseResume(new Uint8Array(Buffer.from(crlf)), 'jane.txt');
    const optimized = structuredClone(parsed.data);
    optimized.summary.text = 'Senior software engineer focused on Python services.';
    optimized.skills[0].items = [...optimized.skills[0].items, 'Go'];
    const { text, warnings } = patchText(crlf, parsed.document, parsed.data, optimized);
    expect(warnings).toEqual([]);
    expect(text.split('\r\n').length).toBe(crlf.split('\r\n').length); // same number of physical lines…
    expect(text).not.toMatch(/[^\r]\n/); // …all still CRLF
    expect(text).toContain('Senior software engineer focused on Python services.');
    expect(text).toMatch(/Go\r\n/);
    // every line that held neither the summary nor the edited skills is unchanged
    const changedLines = new Set([...parsed.data.summary.lines, ...parsed.data.skills[0].lines]);
    const before = crlf.split('\r\n');
    const after = text.split('\r\n');
    const unchanged = before.filter((_, i) => ![...changedLines].some((l) => (parsed.document.lines[l]?.sourceLine ?? -1) === i));
    for (const line of unchanged.filter((l) => l.trim())) expect(after).toContain(line);
  });
});
