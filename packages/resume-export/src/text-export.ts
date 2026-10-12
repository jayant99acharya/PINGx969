import type { ResumeData, ResumeDocument } from '@pingx969/shared';
import { BULLET_RE } from '@pingx969/resume-parser';
import { computeEdits, replaceBulletText, replaceSkillSpan } from './edits';

/**
 * TXT / Markdown export that rewrites only the physical lines that changed; every other line
 * (spacing, headings, separators, markdown syntax) stays byte-identical.
 */
export function patchText(originalText: string, document: ResumeDocument, original: ResumeData, optimized: ResumeData): { text: string; warnings: string[] } {
  const nl = originalText.includes('\r\n') ? '\r\n' : '\n';
  const physical = originalText.replace(/\r\n?/g, '\n').split('\n');
  const warnings: string[] = [];
  // Logical line i -> its physical lines
  const blocks: string[][] = document.lines.map((l) => {
    const start = l.sourceLine ?? 0;
    return physical.slice(start, start + l.span);
  });
  const edits = computeEdits(original, optimized);
  const wrapWidth = Math.max(...physical.map((l) => l.length), 60);

  const rewrite = (i: number, fn: (raw: string) => string | null, label: string) => {
    const l = document.lines[i];
    if (!l) return;
    const joined = blocks[i].map((x, k) => (k === 0 ? x : x.trim())).join(' ');
    const next = fn(joined);
    if (next === null) {
      warnings.push(`Could not update ${label} in place.`);
      return;
    }
    blocks[i] = l.span > 1 ? rewrap(next, wrapWidth, blocks[i][1]?.match(/^\s*/)?.[0] ?? '  ') : [next];
  };

  for (const e of edits.bulletText) {
    rewrite(e.line, (raw) => replaceBulletText(raw, e.oldText, e.newText) ?? (raw.match(BULLET_RE)?.[0] ?? '') + e.newText, 'a bullet');
  }
  for (const s of edits.skills) rewrite(s.line, (raw) => replaceSkillSpan(raw, s.oldItems, s.newItems, s.delimiter), 'a skills line');
  if (edits.summary) {
    const [first, ...rest] = edits.summary.lines;
    rewrite(first, (raw) => {
      // keep an inline label like "Summary: " if present
      const label = raw.match(/^(\s*(?:\*\*)?[A-Za-z ]{3,30}:(?:\*\*)?\s+)/)?.[1] ?? '';
      return label + edits.summary!.newText;
    }, 'the summary');
    for (const r of rest) blocks[r] = [];
  } else if (edits.summaryInsert) {
    const firstHeading = original.headings.find((h) => h.line !== null);
    if (firstHeading?.line !== null && firstHeading?.line !== undefined) {
      const hRaw = blocks[firstHeading.line][0] ?? '';
      const mdPrefix = hRaw.match(/^\s*#{1,6}\s+/)?.[0];
      const headingText = mdPrefix ? `${mdPrefix}Summary` : hRaw.trim() === hRaw.trim().toUpperCase() ? 'SUMMARY' : 'Summary';
      // underline-style plain-text headings
      const next = physical[(document.lines[firstHeading.line].sourceLine ?? 0) + 1] ?? '';
      const underline = /^[=\-_]{3,}\s*$/.test(next) ? [next.trim()[0].repeat(7)] : [];
      blocks[firstHeading.line] = [headingText, ...underline, edits.summaryInsert, '', ...blocks[firstHeading.line]];
    }
  }
  for (const r of edits.reorders) {
    const saved = r.newOrder.map((l) => blocks[l]);
    r.lines.forEach((l, k) => (blocks[l] = saved[k]));
  }
  return { text: blocks.flat().join(nl), warnings };
}

function rewrap(text: string, width: number, contIndent: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of text.split(/ +/)) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > width && cur) {
      out.push(cur);
      cur = contIndent + w;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}
