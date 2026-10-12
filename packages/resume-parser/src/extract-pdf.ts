import { createRequire } from 'node:module';
import path from 'node:path';
import {
  AppError,
  ErrorCodes,
  LayoutProfileSchema,
  type ResumeDocument,
  type SourceLine,
  SourceLineSchema,
} from '@pingx969/shared';
import { classifyFontFamily } from './fonts';
import { mode } from './extract-docx';

interface Item {
  str: string;
  x: number;
  y: number; // distance from top of page to baseline
  w: number;
  size: number;
  font: string;
  bold: boolean;
  italic: boolean;
}

interface Rule {
  y: number;
  x1: number;
  x2: number;
}

const BULLET_CHARS = '•●▪◦‣■□➢►▸–-*·○◆◇✓✔➤→';

let pdfjsPromise: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null;
function loadPdfjs() {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

let fontsDir: string | undefined;
function standardFontsDir(): string | undefined {
  if (fontsDir !== undefined) return fontsDir || undefined;
  try {
    const require = createRequire(import.meta.url);
    // legacy/build/pdf.mjs -> package root
    const entry = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    // pdf.js requires forward slashes and a trailing slash, even on Windows.
    fontsDir = (path.join(path.dirname(entry), '..', '..', 'standard_fonts') + '/').split(path.sep).join('/');
  } catch {
    fontsDir = '';
  }
  return fontsDir || undefined;
}

export async function extractPdf(buf: Uint8Array): Promise<ResumeDocument> {
  const pdfjs = await loadPdfjs();
  let pdf: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
  const standardFontDataUrl = standardFontsDir();
  const task = pdfjs.getDocument({
      data: new Uint8Array(buf),
      // Security: pdf.js >= 6 never evaluates PDF content as code; we additionally disable XFA
      // and font loading, and never run PDF scripting (no viewer/sandbox is used).
      enableXfa: false,
      disableFontFace: true,
      useSystemFonts: false,
      standardFontDataUrl,
      verbosity: 0,
    });
  try {
    pdf = await task.promise;
  } catch (e) {
    void task.destroy();
    const name = (e as Error)?.name ?? '';
    if (name === 'PasswordException') {
      throw new AppError(ErrorCodes.UNSUPPORTED_FILE, 'This PDF is password-protected. Please upload an unprotected copy.', 422);
    }
    throw new AppError(ErrorCodes.CORRUPTED_FILE, 'This PDF could not be read. It may be corrupted or not a valid PDF.', 422, {
      cause: (e as Error)?.message,
    });
  }

  if (pdf.numPages > 15) {
    void task.destroy();
    throw new AppError(ErrorCodes.UNSUPPORTED_FILE, 'This PDF has more than 15 pages, which is unusually long for a resume.', 422);
  }

  const lines: SourceLine[] = [];
  const allItems: Item[] = [];
  let pageWidth = 612;
  let pageHeight = 792;
  let multiColumn = false;
  let hasImages = false;
  const warnings: string[] = [];

  try {
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const vp = page.getViewport({ scale: 1 });
    pageWidth = vp.width;
    pageHeight = vp.height;
    const ops = await page.getOperatorList();
    const { rules, dots } = extractRules(ops, pdfjs.OPS, pageHeight, pageWidth);
    if (ops.fnArray.some((f) => f === pdfjs.OPS.paintImageXObject || f === pdfjs.OPS.paintInlineImageXObject)) hasImages = true;
    const tc = await page.getTextContent();
    const items: Item[] = [];
    for (const raw of tc.items as Array<{ str: string; transform: number[]; width: number; fontName: string; hasEOL?: boolean }>) {
      if (!('str' in raw) || !raw.str) continue;
      const [a, b, , d, e, f] = raw.transform;
      const size = Math.round(Math.hypot(a, b) * 10) / 10 || Math.abs(d);
      let fontName = '';
      try {
        const fo = page.commonObjs.has(raw.fontName) ? (page.commonObjs.get(raw.fontName) as { name?: string; bold?: boolean; italic?: boolean }) : null;
        fontName = fo?.name ?? '';
      } catch {
        /* font object unavailable */
      }
      items.push({
        // Letter-spaced runs ("J A Y A N T") are stored with literal spaces between glyphs.
        str: /^(\p{L} ){2,}\p{L}$/u.test(raw.str) ? raw.str.replace(/ /g, '') : raw.str,
        x: e,
        y: pageHeight - f,
        w: raw.width,
        size,
        font: fontName,
        bold: /bold|black|heavy|semibold|demi/i.test(fontName),
        italic: /italic|oblique/i.test(fontName),
      });
    }
    allItems.push(...items);
    const { columns, isMulti } = splitColumns(items, pageWidth);
    multiColumn ||= isMulti;
    for (const col of columns) {
      const rights = col.filter((i) => i.str.trim()).map((i) => i.x + i.w).sort((a, b) => a - b);
      const colRight = rights[Math.floor(rights.length * 0.95)] ?? pageWidth;
      for (const l of mergeWrapped(buildLines(col, dots), colRight)) {
        const ly = l.y ?? 0;
        const ruleBelow = rules.some((r) => r.y > ly && r.y - ly < Math.max(14, (l.fontSize ?? 10) * 1.6) && r.x2 - r.x1 > pageWidth * 0.3);
        const { textX: _t, vectorBullet: _v, ...rest } = l;
        lines.push(SourceLineSchema.parse({ ...rest, page: pageNo - 1, ruleBelow }));
      }
    }
    page.cleanup();
  }
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(ErrorCodes.CORRUPTED_FILE, 'Part of this PDF could not be read. It may be damaged.', 422, { cause: (e as Error)?.message });
  } finally {
    await task.destroy();
  }

  const textChars = allItems.reduce((n, i) => n + i.str.trim().length, 0);
  if (textChars < 40) {
    throw new AppError(
      ErrorCodes.EMPTY_RESUME,
      'No selectable text was found in this PDF. It looks like a scanned image; please upload a text-based PDF or a DOCX file.',
      422,
    );
  }
  if (multiColumn) warnings.push('Multi-column layout detected. Columns were read left-to-right; check the parsed sections.');

  // Layout profile
  const bodySize = mode(allItems.filter((i) => i.str.trim().length > 2).map((i) => i.size)) ?? 10.5;
  const nonEmpty = lines.filter((l) => l.text.trim());
  const first = nonEmpty[0];
  const firstItem = allItems.find((i) => i.str.trim());
  const maxSize = Math.max(...allItems.map((i) => i.size));
  const nameLine = nonEmpty.find((l) => (l.fontSize ?? 0) >= maxSize - 0.5) ?? first;
  const headingLines = nonEmpty.filter(
    (l) => !l.bullet && l.text.length < 40 && ((l.fontSize ?? 0) > bodySize + 0.4 || (l.bold && l.text === l.text.toUpperCase())) && l !== nameLine,
  );
  const xs = nonEmpty.map((l) => l.x ?? 0).sort((a, b) => a - b);
  const leftMargin = xs[Math.floor(xs.length * 0.05)] ?? 54;
  const rights = allItems.map((i) => i.x + i.w).sort((a, b) => a - b);
  const rightEdge = rights[Math.floor(rights.length * 0.97)] ?? pageWidth - 54;
  const tops = nonEmpty.filter((l) => l.page === 0).map((l) => (l.y ?? 0) - (l.fontSize ?? bodySize));
  const nameCenter = nameLine ? centerOf(allItems, nameLine) : 0;
  const gaps: number[] = [];
  for (let i = 1; i < nonEmpty.length; i++) {
    const a = nonEmpty[i - 1];
    const b = nonEmpty[i];
    if (a.page === b.page && b.y! > a.y!) gaps.push(b.y! - a.y!);
  }
  // The most common baseline gap is the line pitch; larger gaps are section/entry spacing.
  const medianGap = mode(gaps.map((g) => Math.round(g * 2) / 2)) ?? bodySize * 1.25;
  const bulletGlyph = mode(nonEmpty.filter((l) => l.bullet).map((l) => l.bulletGlyph)) ?? '•';
  const fontName = mode(allItems.map((i) => i.font.replace(/^[A-Z]{6}\+/, '').split(/[-,]/)[0]).filter(Boolean)) ?? '';

  const layout = LayoutProfileSchema.parse({
    pageWidth,
    pageHeight,
    margins: {
      top: Math.max(18, Math.min(...(tops.length ? tops : [54]))),
      left: Math.max(18, leftMargin),
      right: Math.max(18, pageWidth - rightEdge),
      bottom: 48,
    },
    fontFamily: classifyFontFamily(fontName),
    fontNameHint: fontName,
    nameSize: nameLine?.fontSize ?? firstItem?.size ?? 18,
    headingSize: mode(headingLines.map((h) => h.fontSize ?? bodySize)) ?? bodySize + 1,
    bodySize,
    contactSize: nonEmpty[1]?.fontSize ?? bodySize,
    nameAlign: Math.abs(nameCenter - pageWidth / 2) < 20 ? 'center' : 'left',
    nameUppercase: !!nameLine && /[A-Z]/.test(nameLine.text) && nameLine.text === nameLine.text.toUpperCase(),
    headingUppercase: headingLines.length ? headingLines.filter((h) => h.text === h.text.toUpperCase()).length >= headingLines.length / 2 : true,
    headingBold: headingLines.length ? headingLines.filter((h) => h.bold).length >= headingLines.length / 2 : true,
    headingRule: headingLines.some((h) => h.ruleBelow),
    bulletGlyph: bulletGlyph === '-' || bulletGlyph === '–' ? bulletGlyph : bulletGlyph || '•',
    lineHeight: Math.min(1.8, Math.max(1.05, medianGap / bodySize)),
    columns: multiColumn ? 2 : 1,
    pageCount: Math.max(1, ...lines.map((l) => (l.page ?? 0) + 1)),
  });

  return {
    format: 'pdf',
    lines,
    layout,
    warnings,
    structure: {
      hasTables: false,
      hasImages,
      hasTextBoxes: false,
      hasHeaderFooterText: false,
      multiColumn,
      pageCount: layout.pageCount,
    },
  };
}

function centerOf(items: Item[], line: SourceLine): number {
  const its = items.filter((i) => Math.abs(i.y - (line.y ?? 0)) < 1 && i.str.trim());
  if (!its.length) return 0;
  const minX = Math.min(...its.map((i) => i.x));
  const maxX = Math.max(...its.map((i) => i.x + i.w));
  return (minX + maxX) / 2;
}

const PUA = /[-]/;
const PUA_G = /[-]/g;

/** A small filled shape (vector bullet dot), in top-based coordinates. */
export interface Dot {
  x: number;
  y: number;
  size: number;
}

/** Group text items into visual lines (baseline clustering), joining with spaces/tabs by gap size. */
function buildLines(items: Item[], dots: Dot[] = []) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: Item[][] = [];
  for (const it of sorted) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g[0].y - it.y) <= Math.max(1.5, Math.min(g[0].size, it.size) * 0.35)) g.push(it);
    else groups.push([it]);
  }
  const out: PdfLine[] = [];
  for (const g of groups) {
    g.sort((a, b) => a.x - b.x);
    // Whitespace-only items (pdf.js inserts them to fill gaps) must not hide column gaps.
    const real = g.filter((i) => i.str.trim());
    if (!real.length) continue;
    const size = Math.max(...real.map((i) => i.size));
    // Letter-spaced text ("J A Y A N T"): every glyph is its own item, so use the gap distribution.
    const singles = real.filter((i) => i.str.trim().length === 1).length;
    const gaps = real.slice(1).map((it, k) => it.x - (real[k].x + real[k].w));
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const letterSpaced = real.length >= 5 && singles / real.length >= 0.7;
    const wordGap = letterSpaced ? Math.max(sortedGaps[Math.floor(sortedGaps.length / 2)] * 1.6, size * 0.25) : size * 0.18;
    let text = '';
    const tabX: number[] = [];
    let prevEnd: number | null = null;
    for (const it of real) {
      if (prevEnd !== null) {
        const gap = it.x - prevEnd;
        if (gap > it.size * 1.2) {
          text += '\t';
          tabX.push(it.x);
        } else if (gap > wordGap && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' ';
      }
      text += it.str;
      prevEnd = it.x + it.w;
    }
    // Icon-font glyphs (location pin, phone, envelope…) act as separators, not content.
    const leadIcon = PUA.test(text.trimStart()[0] ?? '');
    const iconCount = (text.match(PUA_G) ?? []).length;
    text = text
      .replace(/^\s*[-]\s*/, iconCount > 1 ? '' : '$&')
      .replace(/\s*[-]\s*/g, (m, off: number) => (off === 0 ? m : ' | '))
      .replace(/[ \u00a0]{2,}/g, ' ')
      .replace(/\s+$/, '');
    if (!text.trim()) continue;
    const first = real[0];
    let bullet = false;
    let bulletGlyph = '';
    const lead = text.trimStart()[0] ?? '';
    if (lead && (BULLET_CHARS.includes(lead) || (PUA.test(lead) && leadIcon && iconCount === 1))) {
      const after = text.trimStart().slice(1);
      if (/^\s/.test(after) || (real.length > 1 && real[0].str.trim().length === 1)) {
        bullet = true;
        bulletGlyph = PUA.test(lead) ? '•' : lead;
        if (bulletGlyph !== lead) text = text.replace(lead, '•');
      }
    }
    // Bullets drawn as vector dots just left of the text.
    let vectorBullet = false;
    if (!bullet && dots.some((d) => d.x < first.x && first.x - d.x < size * 2.5 && Math.abs(d.y - (first.y - size * 0.32)) < size * 0.55)) {
      bullet = true;
      vectorBullet = true;
      bulletGlyph = '•';
    }
    const chars = real.reduce((n, i) => n + i.str.length, 0) || 1;
    const boldChars = real.filter((i) => i.bold).reduce((n, i) => n + i.str.length, 0);
    out.push({
      text,
      bullet,
      bulletGlyph,
      bold: boldChars / chars > 0.85,
      italic: real.every((i) => i.italic),
      fontSize: size,
      fontName: first?.font ?? '',
      align: 'left',
      styleId: '',
      headingStyle: false,
      paragraph: null,
      inTable: false,
      x: first.x,
      y: first.y,
      yFirst: first.y,
      span: 1,
      right: Math.max(...real.map((i) => i.x + i.w)),
      lastRight: Math.max(...real.map((i) => i.x + i.w)),
      lastText: text,
      tabX,
      vectorBullet,
      textX: bullet && !vectorBullet && real.length > 1 && real[0].str.trim().length === 1 ? real[1].x : first.x + (bullet && !vectorBullet ? first.size : 0),
    });
  }
  return out;
}

type PdfLine = Omit<SourceLine, 'page' | 'ruleBelow' | 'sourceLine' | 'indent'> & { textX: number; vectorBullet: boolean };

/** Re-join visual lines that are wraps of the same bullet or paragraph. */
function mergeWrapped(lines: PdfLine[], colRight: number): PdfLine[] {
  const out: PdfLine[] = [];
  for (const l of lines) {
    const p = out[out.length - 1];
    if (p && !l.bullet && p.y !== null && l.y !== null && l.x !== null && p.x !== null) {
      const size = p.fontSize ?? 10;
      const close = l.y - p.y > 0 && l.y - p.y < size * 1.75;
      const sameStyle = Math.abs((l.fontSize ?? 0) - size) < 0.6 && l.bold === p.bold;
      const noDate = !/(19|20)\d{2}\s*(-|–|—|to)\s*((19|20)\d{2}|present|current)/i.test(l.text);
      const bulletWrap = p.bullet && ((l.x > p.x + 1.5 && l.x < p.x + size * 3) || (p.vectorBullet && Math.abs(l.x - p.x) < 2));
      // A new sentence starting at the left edge after a full stop is a new paragraph/bullet.
      const newSentence = /[.!?]$/.test(p.text.trim()) && /^[A-Z]/.test(l.text.trim()) && (p.right ?? 0) < colRight - size * 3;
      const paraWrap =
        !p.bullet && Math.abs(l.x - p.x) < 2 && (p.right ?? 0) > colRight - size * 5 && p.text.split(/\s+/).length >= 6 && !/[:]$/.test(p.text) && !p.text.includes('\t');
      if (close && sameStyle && noDate && !newSentence && (bulletWrap || paraWrap)) {
        p.text = p.text.endsWith('-') ? p.text + l.text.trim() : `${p.text} ${l.text.trim()}`;
        p.span += 1;
        p.right = Math.max(p.right ?? 0, l.right ?? 0);
        p.lastRight = l.lastRight;
        p.lastText = l.text;
        p.y = l.y; // y = last baseline; yFirst keeps the first
        continue;
      }
    }
    out.push({ ...l });
  }
  return out;
}

/** Detect a vertical gutter splitting the page into two text columns. */
function splitColumns(items: Item[], pageWidth: number): { columns: Item[][]; isMulti: boolean } {
  const textItems = items.filter((i) => i.str.trim());
  if (textItems.length < 12) return { columns: [items], isMulti: false };
  const bin = 4;
  const nb = Math.ceil(pageWidth / bin);
  const cover = new Array<number>(nb).fill(0);
  for (const it of textItems) {
    const a = Math.max(0, Math.floor(it.x / bin));
    const b = Math.min(nb - 1, Math.floor((it.x + it.w) / bin));
    for (let k = a; k <= b; k++) cover[k] += it.str.length;
  }
  const total = cover.reduce((x, y) => x + y, 0);
  let best: [number, number] | null = null;
  let runStart = -1;
  for (let k = Math.floor(nb * 0.2); k <= Math.floor(nb * 0.75); k++) {
    const empty = cover[k] <= total * 0.002;
    if (empty && runStart < 0) runStart = k;
    if ((!empty || k === Math.floor(nb * 0.75)) && runStart >= 0) {
      const len = k - runStart;
      if (len * bin >= 10 && (!best || len > best[1] - best[0])) best = [runStart, k];
      runStart = -1;
    }
  }
  if (!best) return { columns: [items], isMulti: false };
  const splitX = ((best[0] + best[1]) / 2) * bin;
  const left = items.filter((i) => i.x + i.w / 2 < splitX);
  const right = items.filter((i) => i.x + i.w / 2 >= splitX);
  const lc = left.reduce((n, i) => n + i.str.length, 0);
  const rc = right.reduce((n, i) => n + i.str.length, 0);
  // Both sides must carry substantial text and overlap vertically, otherwise it's just indentation.
  const chars = lc + rc;
  if (lc < chars * 0.15 || rc < chars * 0.15) return { columns: [items], isMulti: false };
  const leftYs = new Set(left.map((i) => Math.round(i.y / 4)));
  const shared = right.filter((i) => leftYs.has(Math.round(i.y / 4))).length;
  if (shared < right.length * 0.3) return { columns: [items], isMulti: false };
  return { columns: [left, right], isMulti: true };
}

/** Horizontal rules (thin filled rectangles or stroked lines) in top-based coordinates. */
function extractRules(
  ops: { fnArray: number[]; argsArray: unknown[] },
  OPS: Record<string, number>,
  pageHeight: number,
  pageWidth: number,
): { rules: Rule[]; dots: Dot[] } {
  const rules: Rule[] = [];
  const dots: Dot[] = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const mul = (m: number[], n: number[]) => [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  const apply = (x: number, y: number) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(ctm, args as number[]);
    else if (fn === OPS.paintFormXObjectBegin) {
      // Form XObjects (embedded pages, templates) carry their own matrix.
      stack.push(ctm);
      const m = args?.[0] as number[] | null;
      if (Array.isArray(m) || ArrayBuffer.isView(m)) ctm = mul(ctm, Array.from(m as number[]));
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.constructPath) {
      // pdf.js >= 5: [op, [pathData], minMax]; older: [ops, args, minMax]
      const mm = (args?.[2] ?? null) as number[] | Float32Array | null;
      if (!mm || mm.length < 4) continue;
      const [x1, y1] = apply(mm[0], mm[1]);
      const [x2, y2] = apply(mm[2], mm[3]);
      const h = Math.abs(y2 - y1);
      const w = Math.abs(x2 - x1);
      if (h <= 2.5 && w > pageWidth * 0.25) {
        rules.push({ y: pageHeight - (y1 + y2) / 2, x1: Math.min(x1, x2), x2: Math.max(x1, x2) });
      } else if (w > 1 && h > 1 && w <= 7 && h <= 7 && Math.abs(w - h) < 1.5) {
        dots.push({ x: Math.min(x1, x2), y: pageHeight - (y1 + y2) / 2, size: w });
      }
    }
  }
  return { rules, dots };
}
