import { LayoutProfileSchema, type ResumeDocument, type SourceLine, SourceLineSchema } from '@pingx969/shared';

export const BULLET_RE = /^(\s*)([•●▪◦‣■➢►▸*·○◆✓➤]|-(?=\s)|–(?=\s)|\d{1,2}[.)](?=\s))\s+/;

/**
 * Plain text and Markdown. Each logical line records `sourceLine` (physical line index) and
 * `span` so the exporter can rewrite exactly those physical lines and keep everything else
 * byte-identical. Indented continuation lines of a bullet are merged into the bullet.
 */
export function extractText(text: string, format: 'txt' | 'md'): ResumeDocument {
  const rawLines = text.replace(/\r\n?/g, '\n').split('\n');
  const lines: SourceLine[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i].replace(/\s+$/, '');
    const prev = lines[lines.length - 1];
    // Continuation of a wrapped bullet: indented, non-empty, not itself a bullet/heading.
    if (
      prev &&
      prev.bullet &&
      raw.trim() &&
      /^\s{2,}\S/.test(raw) &&
      !BULLET_RE.test(raw) &&
      !/^\s*#/.test(raw) &&
      prev.sourceLine !== null &&
      prev.sourceLine + prev.span === i
    ) {
      prev.text = `${prev.text} ${raw.trim()}`;
      prev.span += 1;
      continue;
    }
    let bullet = false;
    let glyph = '';
    let headingStyle = false;
    let bold = false;
    let fontSize: number | null = 10.5;
    if (format === 'md') {
      const h = raw.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        headingStyle = h[1].length >= 2;
        fontSize = h[1].length === 1 ? 20 : h[1].length === 2 ? 13 : 11.5;
        bold = true;
      }
      if (/^\s*\*\*[^*]+\*\*\s*$/.test(raw)) bold = true;
    } else if (raw.trim() && /^[=\-_]{3,}\s*$/.test(rawLines[i + 1] ?? '')) {
      headingStyle = true; // setext-style underline in plain text
    }
    const b = raw.match(BULLET_RE);
    if (b) {
      bullet = true;
      glyph = /\d/.test(b[2]) ? 'numbered' : b[2];
    }
    lines.push(
      SourceLineSchema.parse({
        text: raw,
        bullet,
        bulletGlyph: glyph,
        headingStyle,
        bold,
        fontSize,
        sourceLine: i,
        span: 1,
        indent: raw.match(/^\s*/)?.[0] ?? '',
      }),
    );
  }
  return {
    format,
    lines,
    layout: LayoutProfileSchema.parse({ margins: {}, fontFamily: format === 'txt' ? 'mono' : 'sans', bulletGlyph: '•' }),
    warnings: [],
    structure: { hasTables: false, hasImages: false, hasTextBoxes: false, hasHeaderFooterText: false, multiColumn: false, pageCount: 1 },
  };
}

/** Text of a line with list markers and markdown emphasis removed. */
export function cleanLineText(line: Pick<SourceLine, 'text'>, format: string): string {
  let t = line.text;
  if (format === 'md') {
    t = t
      .replace(/^#{1,6}\s+/, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/(?<![*\w])\*([^*\s][^*]*)\*(?!\*)/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) => (label === url ? url : `${label} (${url})`));
    if (/^[=\-_*]{3,}$/.test(t.trim())) return '';
  } else if (/^[=\-_]{3,}$/.test(t.trim())) return '';
  return t.replace(BULLET_RE, '').replace(/^[\s•●▪◦‣■➢►▸·○◆✓➤]+/, '').trim();
}
