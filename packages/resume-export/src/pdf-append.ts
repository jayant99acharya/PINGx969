import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFString, StandardFonts, decodePDFRawStream, rgb, type PDFPage } from 'pdf-lib';
import { filterTextByBaseline } from './pdf-content-filter';
import type { LayoutProfile, ResumeData, ResumeDocument, SourceLine } from '@pingx969/shared';
import { computeEdits } from './edits';

/**
 * "Skills only" PDF export that keeps the ORIGINAL pages. The new skills are typeset right after
 * the last line of the Skills section (in its item column, at its font size) and everything below
 * is shifted down, flowing onto the following page(s) with page breaks only between lines. Pages
 * before the Skills section are copied untouched; link annotations are carried over.
 *
 * Returns null when the edits are not a pure skills append (then the caller re-renders instead).
 */
export async function appendSkillsInPlace(
  originalBytes: Uint8Array,
  document: ResumeDocument,
  original: ResumeData,
  optimized: ResumeData,
): Promise<{ bytes: Uint8Array; warnings: string[] } | null> {
  const added = appendedSkills(original, optimized);
  if (!added) return null;
  if (!added.length) return { bytes: originalBytes, warnings: [] };

  // ---- where the Skills section ends
  const groupLines = original.skills.map((g) => (g.lines.length ? g.lines : g.line !== null ? [g.line] : []));
  const allSkillLines = groupLines.flat().map((i) => ({ i, l: document.lines[i] })).filter((x) => x.l && x.l.page !== null && x.l.y !== null);
  if (!allSkillLines.length) return null;
  const last = allSkillLines.reduce((a, b) => (b.l.page! > a.l.page! || (b.l.page === a.l.page && b.l.y! > a.l.y!) ? b : a));
  const lastGroup = groupLines.find((ls) => ls.includes(last.i)) ?? [last.i];
  const groupFirst = document.lines[lastGroup[0]];
  const L = last.l;
  const origSize = L.fontSize ?? document.layout.bodySize;
  const itemsX = groupFirst.tabX[0] ?? (lastGroup.length > 1 ? L.x! : (L.tabX[0] ?? L.x!));
  const rightLimit = Math.max(...allSkillLines.map((x) => x.l.right ?? 0), itemsX + 120);
  const leading = measureLeading(allSkillLines.map((x) => x.l), origSize);

  let src: PDFDocument;
  try {
    src = await PDFDocument.load(originalBytes, { updateMetadata: false });
  } catch {
    return null; // encrypted or unusual PDF: fall back to re-rendering
  }
  const out = await PDFDocument.create();
  const font = await out.embedFont(fontFor(document.layout));
  // Match the original typeface's set width: size the standard font so the last skills line's
  // text would occupy the same width it does in the original.
  const sample = (L.lastText || L.text).replace(/\t/g, ' ').trim();
  const sampleStart = L.span > 1 || !L.tabX.length ? (L.span > 1 ? itemsX : (L.x ?? itemsX)) : L.tabX[0];
  const measured = (L.lastRight ?? 0) - sampleStart;
  const stdWidth = sample ? font.widthOfTextAtSize(sample.split('\t').pop()!, origSize) : 0;
  const size = stdWidth > 40 && measured > 40 ? origSize * Math.min(1.05, Math.max(0.85, measured / stdWidth)) : origSize;
  const charset = new Set(font.getCharacterSet());
  const safe = (s: string) => [...s].map((c) => (charset.has(c.codePointAt(0)!) ? c : c === '→' ? '->' : '?')).join('');

  // ---- text to insert
  const text = safe(added.join(', '));
  const wrapW = rightLimit - itemsX;
  const newLines: string[] = [];
  let cur = '';
  for (const w of text.split(' ')) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > wrapW && cur) {
      newLines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) newLines.push(cur);
  const h = newLines.length * leading;

  // ---- page geometry (top-based coordinates)
  const k = L.page!;
  const pageCount = src.getPageCount();
  const linesOn = (p: number) => document.lines.filter((l) => l.page === p && l.y !== null && l.text.trim());
  const top = (l: SourceLine) => (l.yFirst ?? l.y!) - (l.fontSize ?? size) * 0.95;
  const bottom = (l: SourceLine) => l.y! + (l.fontSize ?? size) * (l.ruleBelow ? 0.95 : 0.35);
  const H = (p: number) => src.getPage(p).getHeight();
  const W = (p: number) => src.getPage(p).getWidth();
  const contentBottom = Math.max(...Array.from({ length: pageCount }, (_, p) => Math.max(0, ...linesOn(p).map(bottom)))) + 2;
  const continuationTop = pageCount > 1 ? Math.min(...linesOn(1).map(top)) - 2 : document.layout.margins.top;
  const limit = Math.min(contentBottom, H(k) - 24);
  const insertCut = L.y! + size * 0.35;

  interface Segment {
    page: number;
    from: number;
    to: number;
    breaks: number[];
  }
  const breaksFor = (p: number, from: number, to: number): number[] => {
    const ls = linesOn(p).filter((l) => top(l) >= from - 1 && bottom(l) <= to + 1).sort((a, b) => a.y! - b.y!);
    const out: number[] = [];
    for (let i = 0; i < ls.length - 1; i++) {
      const a = ls[i];
      const b = ls[i + 1];
      const headingLike = a.ruleBelow || a.headingStyle || (a.fontSize ?? 0) > size + 1 || (a.bold && a.text.length < 60);
      if (!headingLike && top(b) > bottom(a)) out.push((bottom(a) + top(b)) / 2);
    }
    return out;
  };
  const segments: Segment[] = [];
  const kBottom = Math.max(insertCut, ...linesOn(k).map(bottom)) + 1;
  segments.push({ page: k, from: insertCut, to: kBottom, breaks: breaksFor(k, insertCut, kBottom) });
  for (let p = k + 1; p < pageCount; p++) {
    const ls = linesOn(p);
    if (!ls.length) continue;
    const f = Math.min(...ls.map(top)) - 6;
    const t = Math.max(...ls.map(bottom)) + 1;
    segments.push({ page: p, from: f, to: t, breaks: breaksFor(p, f, t) });
  }

  // ---- assemble
  const before = k > 0 ? await out.copyPages(src, Array.from({ length: k }, (_, i) => i)) : [];
  for (const pg of before) out.addPage(pg);
  const placements: { page: number; from: number; to: number; outPage: PDFPage; offset: number }[] = [];
  const decoded = new Map<number, Uint8Array>();
  const contentOf = (p: number): Uint8Array => {
    if (!decoded.has(p)) decoded.set(p, decodePageContents(src.getPage(p)));
    return decoded.get(p)!;
  };
  const place = async (outPage: PDFPage, p: number, from: number, to: number, at: number) => {
    const sp = src.getPage(p);
    const originalContents = sp.node.get(PDFName.of('Contents'));
    // Keep only the text whose baseline is inside this slice (ATS-safe: no hidden duplicates).
    const filtered = filterTextByBaseline(
      contentOf(p),
      (yUser) => {
        const yTop = H(p) - yUser;
        return yTop >= from - 0.5 && yTop <= to + 0.5;
      },
      // shapes (rules, table borders, bullet dots) that don't touch this slice are dropped too
      (minY, maxY) => H(p) - minY >= from - 1 && H(p) - maxY <= to + 1,
    );
    sp.node.set(PDFName.of('Contents'), src.context.register(src.context.flateStream(filtered)));
    const emb = await out.embedPage(sp, { left: 0, right: W(p), top: H(p) - from, bottom: H(p) - to });
    await emb.embed(); // embed now, while the filtered contents are in place
    if (originalContents) sp.node.set(PDFName.of('Contents'), originalContents);
    outPage.drawPage(emb, { x: 0, y: outPage.getHeight() - at - (to - from) });
    placements.push({ page: p, from, to, outPage, offset: at - from });
  };

  let page = out.addPage([W(k), H(k)]);
  await place(page, k, 0, insertCut, 0);
  // the new skills, continuing the last skills line
  const color = rgb(0.12, 0.12, 0.12);
  const endX = L.lastRight ?? L.right; // end of the last *visual* line of the Skills section
  if (!/,\s*$/.test(L.text) && endX && endX + font.widthOfTextAtSize(',', size) < W(k) - 4) {
    page.drawText(',', { x: endX, y: page.getHeight() - L.y!, size, font, color });
  }
  newLines.forEach((ln, n) => page.drawText(ln, { x: itemsX, y: page.getHeight() - (L.y! + leading * (n + 1)), size, font, color }));
  let cursor = insertCut + h;

  for (const seg of segments) {
    let s = seg.from;
    while (s < seg.to - 0.5) {
      const avail = limit - cursor;
      if (seg.to - s <= avail) {
        await place(page, seg.page, s, seg.to, cursor);
        cursor += seg.to - s;
        break;
      }
      const fits = seg.breaks.filter((b) => b > s + 1 && b - s <= avail);
      if (fits.length) {
        const b = fits[fits.length - 1];
        await place(page, seg.page, s, b, cursor);
        s = b;
      } else if (cursor > continuationTop + 1) {
        // nothing fits on this page any more — continue on a new page
      } else {
        // a single block taller than a page: place what fits
        await place(page, seg.page, s, s + avail, cursor);
        s += avail;
      }
      page = out.addPage([W(seg.page), H(seg.page)]);
      cursor = continuationTop;
    }
  }

  carryLinks(src, out, k, placements);
  copyMetadata(src, out);
  return { bytes: await out.save(), warnings: [] };
}

/** Skills appended to existing groups (in group order), or null if anything else changed. */
export function appendedSkills(original: ResumeData, optimized: ResumeData): string[] | null {
  const e = computeEdits(original, optimized);
  if (e.bulletText.length || e.summary || e.summaryInsert || e.reorders.length) return null;
  const added: string[] = [];
  for (const s of e.skills) {
    const prefixOk = s.oldItems.every((it, i) => s.newItems[i] === it);
    if (!prefixOk) return null;
    added.push(...s.newItems.slice(s.oldItems.length));
  }
  return added;
}

function measureLeading(lines: SourceLine[], size: number): number {
  const gaps: number[] = [];
  for (const l of lines) if (l.span > 1 && l.yFirst !== null && l.y !== null) gaps.push((l.y - l.yFirst) / (l.span - 1));
  const sorted = [...lines].filter((l) => l.y !== null).sort((a, b) => a.y! - b.y!);
  for (let i = 1; i < sorted.length; i++) {
    const g = (sorted[i].yFirst ?? sorted[i].y!) - sorted[i - 1].y!;
    if (g > 0) gaps.push(g);
  }
  gaps.sort((a, b) => a - b);
  const g = gaps[Math.floor(gaps.length / 2)];
  return g && g > size * 0.9 && g < size * 2 ? g : size * 1.25;
}

function fontFor(layout: LayoutProfile) {
  return layout.fontFamily === 'serif' ? StandardFonts.TimesRoman : layout.fontFamily === 'mono' ? StandardFonts.Courier : StandardFonts.Helvetica;
}

function copyMetadata(src: PDFDocument, out: PDFDocument) {
  const t = src.getTitle();
  if (t) out.setTitle(t);
  const a = src.getAuthor();
  if (a) out.setAuthor(a);
  const s = src.getSubject();
  if (s) out.setSubject(s);
  out.setProducer('PINGx969');
}

/** Re-create URI link annotations from shifted pages at their new positions. */
function carryLinks(src: PDFDocument, out: PDFDocument, fromPage: number, placements: { page: number; from: number; to: number; outPage: PDFPage; offset: number }[]) {
  for (let p = fromPage; p < src.getPageCount(); p++) {
    const sp = src.getPage(p);
    const annots = sp.node.Annots();
    if (!annots) continue;
    const H = sp.getHeight();
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookup(i);
      if (!(a instanceof PDFDict) || a.get(PDFName.of('Subtype'))?.toString() !== '/Link') continue;
      const act = a.lookup(PDFName.of('A'));
      const uriObj = act instanceof PDFDict ? act.lookup(PDFName.of('URI')) : undefined;
      const uri = uriObj instanceof PDFString || uriObj instanceof PDFHexString ? uriObj.decodeText() : null;
      const rect = a.lookup(PDFName.of('Rect'));
      if (!uri || !(rect instanceof PDFArray)) continue;
      const [x1, y1, x2, y2] = rect.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : 0));
      const topY = H - Math.max(y1, y2);
      const botY = H - Math.min(y1, y2);
      const mid = (topY + botY) / 2;
      const pl = placements.find((q) => q.page === p && mid >= q.from && mid <= q.to);
      if (!pl) continue;
      const oh = pl.outPage.getHeight();
      const annot = out.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [x1, oh - (botY + pl.offset), x2, oh - (topY + pl.offset)],
        Border: [0, 0, 0],
        A: { Type: 'Action', S: 'URI', URI: PDFString.of(uri) },
      });
      pl.outPage.node.addAnnot(out.context.register(annot));
    }
  }
}

/** Concatenated, decoded content streams of a page. */
function decodePageContents(page: PDFPage): Uint8Array {
  const contents = page.node.normalizedEntries().Contents;
  const parts: Uint8Array[] = [];
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => page.doc.context.lookup(r)) : [contents];
  for (const st of streams) {
    if (st instanceof PDFRawStream) parts.push(decodePDFRawStream(st).decode());
    else if (st && 'getContents' in (st as object)) parts.push((st as unknown as { getContents(): Uint8Array }).getContents());
  }
  const total = parts.reduce((n, x) => n + x.length + 1, 0);
  const outBuf = new Uint8Array(total);
  let o = 0;
  for (const x of parts) {
    outBuf.set(x, o);
    o += x.length;
    outBuf[o++] = 0x0a;
  }
  return outBuf;
}
