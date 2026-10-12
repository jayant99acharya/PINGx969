import type { Bullet, ResumeData } from '@pingx969/shared';

/**
 * Concrete edits between the original and optimized resume, expressed against source
 * line indices so each exporter can patch the original document instead of re-templating.
 */
export interface ResumeEdits {
  bulletText: { line: number; oldText: string; newText: string }[];
  skills: { line: number; category: string | null; oldItems: string[]; newItems: string[]; delimiter: string }[];
  summary: { lines: number[]; oldText: string; newText: string } | null;
  /** Insert a new summary (original had none). */
  summaryInsert: string | null;
  reorders: { lines: number[]; newOrder: number[] }[];
}

export function computeEdits(original: ResumeData, optimized: ResumeData): ResumeEdits {
  const edits: ResumeEdits = { bulletText: [], skills: [], summary: null, summaryInsert: null, reorders: [] };
  const groups: [Bullet[], Bullet[]][] = [
    ...original.experience.map((e) => [e.bullets, optimized.experience.find((x) => x.id === e.id)?.bullets ?? e.bullets] as [Bullet[], Bullet[]]),
    ...original.projects.map((p) => [p.bullets, optimized.projects.find((x) => x.id === p.id)?.bullets ?? p.bullets] as [Bullet[], Bullet[]]),
  ];
  for (const [orig, next] of groups) {
    const byId = new Map(next.map((b) => [b.id, b]));
    for (const b of orig) {
      const n = byId.get(b.id);
      if (n && b.line !== null && n.text !== b.text) edits.bulletText.push({ line: b.line, oldText: b.text, newText: n.text });
    }
    const origLines = orig.map((b) => b.line).filter((l): l is number => l !== null);
    const newLines = next.map((b) => orig.find((o) => o.id === b.id)?.line ?? null).filter((l): l is number => l !== null);
    if (origLines.length === orig.length && newLines.length === origLines.length && newLines.some((l, i) => l !== origLines[i])) {
      edits.reorders.push({ lines: origLines, newOrder: newLines });
    }
  }
  for (const g of original.skills) {
    const n = optimized.skills.find((x) => x.id === g.id);
    if (n && g.line !== null && n.items.join('\u0000') !== g.items.join('\u0000')) {
      edits.skills.push({ line: g.line, category: g.category, oldItems: g.items, newItems: n.items, delimiter: g.delimiter || ', ' });
    }
  }
  if (optimized.summary.text.trim() && optimized.summary.text !== original.summary.text) {
    if (original.summary.lines.length) edits.summary = { lines: original.summary.lines, oldText: original.summary.text, newText: optimized.summary.text };
    else edits.summaryInsert = optimized.summary.text;
  }
  return edits;
}

/**
 * Replace the item list inside a raw skills line, keeping everything before the first item
 * (e.g. a bold "Languages: " label) and after the last item untouched.
 */
export function replaceSkillSpan(raw: string, oldItems: string[], newItems: string[], delimiter: string): string | null {
  if (!oldItems.length) return null;
  const start = raw.indexOf(oldItems[0]);
  const lastItem = oldItems[oldItems.length - 1];
  const lastIdx = raw.lastIndexOf(lastItem);
  if (start < 0 || lastIdx < start) return null;
  const end = lastIdx + lastItem.length;
  return raw.slice(0, start) + newItems.join(delimiter) + raw.slice(end);
}

/** Replace the bullet's clean text inside the raw line, keeping glyphs/markup prefix. */
export function replaceBulletText(raw: string, oldText: string, newText: string): string | null {
  const i = raw.indexOf(oldText);
  if (i >= 0) return raw.slice(0, i) + newText + raw.slice(i + oldText.length);
  return null;
}
