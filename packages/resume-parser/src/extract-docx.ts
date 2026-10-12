import JSZip from 'jszip';
import {
  AppError,
  ErrorCodes,
  LayoutProfileSchema,
  type LayoutProfile,
  type ResumeDocument,
  type SourceLine,
  SourceLineSchema,
} from '@pingx969/shared';
import { allParagraphs, paragraphAtoms, runProps } from './docx-model';
import { attr, child, children, closest, descendants, parseXml } from './xml';
import { classifyFontFamily } from './fonts';

interface StyleInfo {
  name: string;
  basedOn: string | null;
  bold: boolean | null;
  size: number | null;
  font: string;
  isHeading: boolean;
  hasNumbering: boolean;
  caps: boolean | null;
  jc: string | null;
}

export async function loadDocxZip(buf: Uint8Array): Promise<JSZip> {
  try {
    const zip = await JSZip.loadAsync(buf);
    if (!zip.file('word/document.xml')) throw new Error('missing document.xml');
    return zip;
  } catch {
    throw new AppError(
      ErrorCodes.CORRUPTED_FILE,
      'This Word document could not be opened. It may be corrupted, password-protected, or not a real .docx file.',
      422,
    );
  }
}

export async function extractDocx(buf: Uint8Array): Promise<ResumeDocument> {
  const zip = await loadDocxZip(buf);
  const docXml = await zip.file('word/document.xml')!.async('string');
  const doc = parseXml(docXml);
  const stylesXml = await zip.file('word/styles.xml')?.async('string');
  const numberingXml = await zip.file('word/numbering.xml')?.async('string');
  const themeXml = await zip.file('word/theme/theme1.xml')?.async('string');
  const styles = stylesXml ? parseStyles(parseXml(stylesXml)) : { map: new Map<string, StyleInfo>(), defaultSize: 11, defaultFont: '' };
  const numbering = numberingXml ? parseNumbering(parseXml(numberingXml)) : new Map<string, Map<number, { fmt: string; text: string }>>();
  const themeFont = themeXml ? parseThemeMinorFont(parseXml(themeXml)) : '';
  const warnings: string[] = [];

  const resolveStyle = (id: string | null): StyleInfo | null => {
    let cur = id ? styles.map.get(id) : undefined;
    if (!cur) return null;
    const merged: StyleInfo = { ...cur };
    let guard = 0;
    while (cur?.basedOn && guard++ < 10) {
      const parent = styles.map.get(cur.basedOn);
      if (!parent) break;
      merged.bold ??= parent.bold;
      merged.size ??= parent.size;
      merged.font ||= parent.font;
      merged.isHeading ||= parent.isHeading;
      merged.hasNumbering ||= parent.hasNumbering;
      merged.caps ??= parent.caps;
      merged.jc ??= parent.jc;
      cur = parent;
    }
    return merged;
  };

  const lines: SourceLine[] = [];
  const paragraphs = allParagraphs(doc);
  paragraphs.forEach((p, index) => {
    const pPr = child(p, 'w:pPr');
    const styleId = attr(child(pPr, 'w:pStyle'), 'w:val');
    const style = resolveStyle(styleId);
    const numPr = child(pPr, 'w:numPr');
    const atoms = paragraphAtoms(p);
    const text = atoms.map((a) => a.text).join('');
    const textRuns = atoms.filter((a) => a.node.nodeName === 'w:t' && a.text.trim());
    const props = textRuns.map((a) => runProps(a.run));
    const isBold = (x: (typeof props)[number]) => x.bold ?? style?.bold ?? false;
    const allBold = props.length > 0 && props.every(isBold);
    const sizes = props.map((x) => x.size ?? style?.size ?? styles.defaultSize);
    const fontSize = sizes.length ? Math.max(...sizes) : (style?.size ?? styles.defaultSize);
    const font = props.find((x) => x.font)?.font || style?.font || styles.defaultFont || themeFont;
    const caps = props.length > 0 && props.every((x) => x.caps ?? style?.caps ?? false);

    let bullet = false;
    let bulletGlyph = '';
    if (numPr || style?.hasNumbering) {
      const numId = attr(child(numPr, 'w:numId'), 'w:val');
      const ilvl = Number(attr(child(numPr, 'w:ilvl'), 'w:val') ?? '0');
      const lvl = numId ? numbering.get(numId)?.get(ilvl) : undefined;
      if (numId !== '0') {
        bullet = true;
        bulletGlyph = lvl?.fmt === 'bullet' ? normalizeGlyph(lvl.text) : lvl ? 'numbered' : '•';
      }
    }
    const jc = attr(child(pPr, 'w:jc'), 'w:val') ?? style?.jc ?? 'left';
    const align = jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' ? 'justify' : 'left';
    const ruleBelow = !!child(child(pPr, 'w:pBdr'), 'w:bottom');
    const inTable = !!closest(p, 'w:tbl');

    // Soft line breaks inside one paragraph become separate logical lines that share the paragraph index.
    const parts = text.split('\n');
    parts.forEach((part, i) => {
      lines.push(
        SourceLineSchema.parse({
          text: part.replace(/\t+/g, '\t').replace(/\s+$/, ''),
          bullet,
          bulletGlyph,
          bold: allBold,
          italic: props.length > 0 && props.every((x) => x.italic ?? false),
          fontSize,
          fontName: font,
          align,
          styleId: styleId ?? '',
          // Paragraphs rendered in small caps/all caps via formatting look like headings.
          headingStyle: !!style?.isHeading || (caps && allBold),
          paragraph: parts.length > 1 ? index : index,
          inTable,
          ruleBelow: ruleBelow && i === parts.length - 1,
        }),
      );
    });
  });

  // Structure facts for ATS checks
  const hasTables = descendants(doc, 'w:tbl').length > 0;
  const hasTextBoxes = descendants(doc, 'w:txbxContent').length > 0;
  const hasImages = descendants(doc, 'pic:pic').length > 0 || descendants(doc, 'v:imagedata').length > 0;
  let hasHeaderFooterText = false;
  for (const name of Object.keys(zip.files)) {
    if (/^word\/(header|footer)\d*\.xml$/.test(name)) {
      const hx = parseXml(await zip.file(name)!.async('string'));
      const t = descendants(hx, 'w:t').map((n) => n.textContent ?? '').join('').trim();
      if (t.length > 3) hasHeaderFooterText = true;
    }
  }
  if (hasTables) warnings.push('This document uses tables for layout. Some ATS systems read tables poorly.');
  if (hasTextBoxes) warnings.push('This document contains text boxes; their content may be skipped by ATS parsers.');

  const layout = docxLayout(doc, lines, styles.defaultSize, styles.defaultFont || themeFont);
  const sectionCount = descendants(doc, 'w:cols').some((c) => Number(attr(c, 'w:num') ?? '1') > 1);

  return {
    format: 'docx',
    lines,
    layout,
    warnings,
    structure: {
      hasTables,
      hasImages,
      hasTextBoxes,
      hasHeaderFooterText,
      multiColumn: sectionCount,
      pageCount: Math.max(1, descendants(doc, 'w:br').filter((b) => attr(b, 'w:type') === 'page').length + 1),
    },
  };
}

function normalizeGlyph(t: string): string {
  if (!t) return '•';
  const c = t.trim();
  // Symbol/Wingdings private-use bullets map to a plain bullet
  if (/^[-]$/.test(c) || c === 'o' || c === '·') return c === 'o' ? '◦' : '•';
  return c;
}

function parseStyles(doc: Document) {
  const map = new Map<string, StyleInfo>();
  let defaultSize = 11;
  let defaultFont = '';
  const defaults = descendants(doc, 'w:docDefaults')[0];
  if (defaults) {
    const sz = descendants(defaults, 'w:sz')[0];
    if (sz) defaultSize = Number(attr(sz, 'w:val')) / 2 || 11;
    const rf = descendants(defaults, 'w:rFonts')[0];
    defaultFont = attr(rf, 'w:ascii') ?? attr(rf, 'w:hAnsi') ?? '';
  }
  for (const s of descendants(doc, 'w:style')) {
    const id = attr(s, 'w:styleId');
    if (!id) continue;
    const name = (attr(child(s, 'w:name'), 'w:val') ?? id).toLowerCase();
    const rPr = child(s, 'w:rPr');
    const pPr = child(s, 'w:pPr');
    const b = child(rPr, 'w:b');
    const caps = child(rPr, 'w:caps');
    const sz = child(rPr, 'w:sz');
    const rf = child(rPr, 'w:rFonts');
    map.set(id, {
      name,
      basedOn: attr(child(s, 'w:basedOn'), 'w:val'),
      bold: b ? !['0', 'false'].includes(attr(b, 'w:val') ?? '') : null,
      caps: caps ? !['0', 'false'].includes(attr(caps, 'w:val') ?? '') : null,
      size: sz ? Number(attr(sz, 'w:val')) / 2 : null,
      font: attr(rf, 'w:ascii') ?? '',
      isHeading: /^heading\s*\d|^title$/.test(name),
      hasNumbering: !!child(pPr, 'w:numPr') || /list bullet|list number/.test(name),
      jc: attr(child(pPr, 'w:jc'), 'w:val'),
    });
    if (attr(s, 'w:default') === '1' && attr(s, 'w:type') === 'paragraph') {
      const st = map.get(id)!;
      if (st.size) defaultSize = st.size;
      if (st.font) defaultFont = st.font;
    }
  }
  return { map, defaultSize, defaultFont };
}

function parseNumbering(doc: Document) {
  const abstract = new Map<string, Map<number, { fmt: string; text: string }>>();
  for (const a of descendants(doc, 'w:abstractNum')) {
    const id = attr(a, 'w:abstractNumId')!;
    const lvls = new Map<number, { fmt: string; text: string }>();
    for (const l of children(a, 'w:lvl')) {
      lvls.set(Number(attr(l, 'w:ilvl') ?? '0'), {
        fmt: attr(child(l, 'w:numFmt'), 'w:val') ?? 'bullet',
        text: attr(child(l, 'w:lvlText'), 'w:val') ?? '•',
      });
    }
    abstract.set(id, lvls);
  }
  const nums = new Map<string, Map<number, { fmt: string; text: string }>>();
  for (const n of descendants(doc, 'w:num')) {
    const id = attr(n, 'w:numId')!;
    const absId = attr(child(n, 'w:abstractNumId'), 'w:val');
    if (absId && abstract.has(absId)) nums.set(id, abstract.get(absId)!);
  }
  return nums;
}

function parseThemeMinorFont(doc: Document): string {
  const minor = descendants(doc, 'a:minorFont')[0];
  return attr(child(minor, 'a:latin'), 'typeface') ?? '';
}

function docxLayout(doc: Document, lines: SourceLine[], defaultSize: number, defaultFont: string): LayoutProfile {
  const sect = descendants(doc, 'w:sectPr').pop();
  const pgSz = child(sect, 'w:pgSz');
  const pgMar = child(sect, 'w:pgMar');
  const tw = (v: string | null, d: number) => (v ? Number(v) / 20 : d);
  const nonEmpty = lines.filter((l) => l.text.trim());
  const sizes = nonEmpty.map((l) => l.fontSize ?? defaultSize);
  const bodySize = mode(sizes) ?? defaultSize;
  const first = nonEmpty[0];
  const headings = nonEmpty.filter(
    (l) => !l.bullet && l.text.length < 40 && (l.headingStyle || (l.bold && l.text === l.text.toUpperCase() && /[A-Z]/.test(l.text))),
  );
  const fontName = mode(nonEmpty.map((l) => l.fontName).filter(Boolean)) ?? defaultFont;
  const bulletGlyph = mode(nonEmpty.filter((l) => l.bullet && l.bulletGlyph !== 'numbered').map((l) => l.bulletGlyph)) ?? '•';
  return LayoutProfileSchema.parse({
    pageWidth: tw(attr(pgSz, 'w:w'), 612),
    pageHeight: tw(attr(pgSz, 'w:h'), 792),
    margins: {
      top: tw(attr(pgMar, 'w:top'), 72),
      right: tw(attr(pgMar, 'w:right'), 72),
      bottom: tw(attr(pgMar, 'w:bottom'), 72),
      left: tw(attr(pgMar, 'w:left'), 72),
    },
    fontFamily: classifyFontFamily(fontName),
    fontNameHint: fontName,
    nameSize: first?.fontSize ?? bodySize + 8,
    headingSize: mode(headings.map((h) => h.fontSize ?? bodySize)) ?? bodySize + 1,
    bodySize,
    contactSize: nonEmpty[1]?.fontSize ?? bodySize,
    nameAlign: first?.align === 'center' ? 'center' : 'left',
    nameUppercase: !!first && /[A-Z]/.test(first.text) && first.text === first.text.toUpperCase(),
    headingUppercase: headings.length ? headings.filter((h) => h.text === h.text.toUpperCase()).length >= headings.length / 2 : true,
    headingBold: headings.length ? headings.filter((h) => h.bold).length >= headings.length / 2 : true,
    headingRule: headings.some((h) => h.ruleBelow),
    bulletGlyph,
  });
}

export function mode<T>(arr: T[]): T | undefined {
  const m = new Map<T, number>();
  for (const x of arr) m.set(x, (m.get(x) ?? 0) + 1);
  let best: T | undefined;
  let n = 0;
  for (const [k, v] of m) if (v > n) { best = k; n = v; }
  return best;
}
