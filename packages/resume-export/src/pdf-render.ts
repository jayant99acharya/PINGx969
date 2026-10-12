import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { type LayoutProfile, LayoutProfileSchema, type ResumeData, type SectionKey, formatDateForDisplay } from '@pingx969/shared';

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

const FAMILIES: Record<LayoutProfile['fontFamily'], [StandardFonts, StandardFonts, StandardFonts]> = {
  sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique],
  serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic],
  mono: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique],
};

const REPLACEMENTS: Record<string, string> = { '→': '->', '←': '<-', '✓': '-', '✔': '-', '●': '•', '▪': '•', '◦': '•', '‣': '•', '■': '•', '➢': '•', '►': '•', '▸': '•', ' ': ' ', '\t': '  ' };

function hexColor(hex: string) {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255) : rgb(0, 0, 0);
}

/**
 * Renders a resume PDF that mirrors the original's layout profile (page size, margins,
 * font family, sizes, heading case/rules, bullet glyph, name alignment, section order).
 * Standard PDF fonts are used, so the typeface is the closest standard family.
 */
export async function renderPdf(data: ResumeData, layoutIn?: Partial<LayoutProfile>, meta: { title?: string } = {}): Promise<Uint8Array> {
  const L = LayoutProfileSchema.parse({ margins: {}, ...(layoutIn ?? {}) });
  const pdf = await PDFDocument.create();
  pdf.setTitle(meta.title ?? `${data.personal.name || 'Resume'}`);
  pdf.setCreator('PINGx969');
  pdf.setProducer('PINGx969');
  const [r, b, i] = FAMILIES[L.fontFamily];
  const fonts: Fonts = { regular: await pdf.embedFont(r), bold: await pdf.embedFont(b), italic: await pdf.embedFont(i) };
  const charset = new Set(fonts.regular.getCharacterSet());
  const safe = (s: string) =>
    Array.from(s)
      .map((c) => REPLACEMENTS[c] ?? c)
      .join('')
      .split('')
      .map((c) => (charset.has(c.codePointAt(0)!) || c === ' ' ? c : '?'))
      .join('');

  const margins = { top: clamp(L.margins.top, 24, 108), right: clamp(L.margins.right, 24, 108), bottom: clamp(L.margins.bottom, 24, 108), left: clamp(L.margins.left, 24, 108) };
  const width = L.pageWidth - margins.left - margins.right;
  const body = clamp(L.bodySize, 8, 13);
  const lead = body * clamp(L.lineHeight, 1.1, 1.6);
  const color = rgb(0.1, 0.1, 0.1);
  let page: PDFPage = pdf.addPage([L.pageWidth, L.pageHeight]);
  let y = L.pageHeight - margins.top;

  const ensure = (h: number) => {
    if (y - h < margins.bottom) {
      page = pdf.addPage([L.pageWidth, L.pageHeight]);
      y = L.pageHeight - margins.top;
    }
  };
  const wrap = (text: string, font: PDFFont, size: number, maxW: number): string[] => {
    const words = safe(text).split(/\s+/).filter(Boolean);
    const out: string[] = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > maxW && cur) {
        out.push(cur);
        cur = w;
      } else cur = next;
    }
    if (cur) out.push(cur);
    return out;
  };
  const para = (text: string, font = fonts.regular, size = body, indent = 0) => {
    for (const ln of wrap(text, font, size, width - indent)) {
      ensure(lead);
      y -= lead;
      page.drawText(ln, { x: margins.left + indent, y, size, font, color });
    }
  };
  /** Left segments (bold first part) + right-aligned text on one line. */
  const headerLine = (parts: { text: string; font: PDFFont }[], right: string) => {
    ensure(lead);
    y -= lead;
    let x = margins.left;
    const rightW = right ? fonts.italic.widthOfTextAtSize(safe(right), body) : 0;
    for (const p of parts) {
      const t = safe(p.text);
      const avail = margins.left + width - rightW - 8 - x;
      const fitted = fit(t, p.font, body, avail);
      page.drawText(fitted, { x, y, size: body, font: p.font, color });
      x += p.font.widthOfTextAtSize(fitted, body);
    }
    if (right) page.drawText(safe(right), { x: margins.left + width - rightW, y, size: body, font: fonts.italic, color });
  };
  const bullet = (text: string) => {
    const glyph = safe(L.bulletGlyph === 'numbered' ? '•' : L.bulletGlyph || '•');
    const indent = body * 1.4;
    const lines = wrap(text, fonts.regular, body, width - indent);
    lines.forEach((ln, k) => {
      ensure(lead);
      y -= lead;
      if (k === 0) page.drawText(glyph, { x: margins.left + body * 0.3, y, size: body, font: fonts.regular, color });
      page.drawText(ln, { x: margins.left + indent, y, size: body, font: fonts.regular, color });
    });
  };
  const heading = (title: string) => {
    const size = clamp(L.headingSize, 9, 18);
    ensure(size * 2.4 + lead * 2);
    y -= clamp(L.sectionSpacing, 6, 18) + size;
    const text = safe(L.headingUppercase ? title.toUpperCase() : title);
    page.drawText(text, { x: margins.left, y, size, font: L.headingBold ? fonts.bold : fonts.regular, color: hexColor(L.headingColor) });
    if (L.headingRule) {
      page.drawLine({ start: { x: margins.left, y: y - 4 }, end: { x: margins.left + width, y: y - 4 }, thickness: 0.8, color: rgb(0.45, 0.45, 0.45) });
      y -= 4;
    }
    y -= 2;
  };

  // Name + contact
  const p = data.personal;
  const nameSize = clamp(L.nameSize, 14, 32);
  const nameText = safe(L.nameUppercase ? (p.name || 'Your Name').toUpperCase() : p.name || 'Your Name');
  y -= nameSize * 0.8;
  const nameW = fonts.bold.widthOfTextAtSize(nameText, nameSize);
  page.drawText(nameText, { x: L.nameAlign === 'center' ? (L.pageWidth - nameW) / 2 : margins.left, y, size: nameSize, font: fonts.bold, color });
  y -= 4;
  const contact = [p.location, p.email, p.phone, ...data.links.filter((l) => l.kind !== 'other').map((l) => l.url.replace(/^https?:\/\/(www\.)?/, ''))].filter(Boolean).join('  |  ');
  const contactSize = clamp(L.contactSize, 7, 12);
  for (const ln of wrap(contact, fonts.regular, contactSize, width)) {
    y -= contactSize * 1.35;
    const w = fonts.regular.widthOfTextAtSize(ln, contactSize);
    page.drawText(ln, { x: L.nameAlign === 'center' ? (L.pageWidth - w) / 2 : margins.left, y, size: contactSize, font: fonts.regular, color });
  }
  if (p.headline) {
    y -= contactSize * 1.35;
    const t = safe(p.headline);
    const w = fonts.italic.widthOfTextAtSize(t, contactSize);
    page.drawText(fit(t, fonts.italic, contactSize, width), { x: L.nameAlign === 'center' ? (L.pageWidth - Math.min(w, width)) / 2 : margins.left, y, size: contactSize, font: fonts.italic, color });
  }

  // Section order follows the original document; generated summary goes first.
  const order = sectionOrder(data);
  for (const s of order) {
    switch (s.section) {
      case 'summary':
        if (!data.summary.text) break;
        heading(s.title);
        para(data.summary.text);
        break;
      case 'experience':
        if (!data.experience.length) break;
        heading(s.title);
        data.experience.forEach((e, k) => {
          if (k) y -= lead * 0.35;
          const dates = e.dateText || [formatDateForDisplay(e.startDate), formatDateForDisplay(e.endDate)].filter(Boolean).join(' – ');
          headerLine(
            [
              { text: e.title || e.company, font: fonts.bold },
              { text: [e.title ? e.company : '', e.location].filter(Boolean).map((x) => ` | ${x}`).join(''), font: fonts.regular },
            ],
            dates,
          );
          for (const bl of e.bullets) bullet(bl.text);
        });
        break;
      case 'education':
        if (!data.education.length) break;
        heading(s.title);
        for (const e of data.education) {
          const deg = [e.degree, e.field].filter(Boolean).join(', ');
          headerLine([{ text: e.institution || deg, font: fonts.bold }, { text: e.institution && deg ? ` | ${deg}` : '', font: fonts.regular }], e.dateText || formatDateForDisplay(e.endDate));
          if (e.gpa) para(`GPA: ${e.gpa}`);
          for (const d of e.details) bullet(d);
        }
        break;
      case 'skills':
        if (!data.skills.length) break;
        heading(s.title);
        for (const g of data.skills) {
          if (g.category) {
            const label = safe(`${g.category}: `);
            const items = g.items.join(g.delimiter || ', ');
            const lw = fonts.bold.widthOfTextAtSize(label, body);
            const lines = wrap(items, fonts.regular, body, width - lw);
            lines.forEach((ln, k) => {
              ensure(lead);
              y -= lead;
              if (k === 0) page.drawText(label, { x: margins.left, y, size: body, font: fonts.bold, color });
              page.drawText(ln, { x: margins.left + lw, y, size: body, font: fonts.regular, color });
            });
          } else para(g.items.join(g.delimiter || ', '));
        }
        break;
      case 'projects':
        if (!data.projects.length) break;
        heading(s.title);
        data.projects.forEach((pr, k) => {
          if (k) y -= lead * 0.35;
          headerLine([{ text: pr.name, font: fonts.bold }, { text: pr.url ? ` | ${pr.url}` : '', font: fonts.regular }], pr.dateText);
          if (pr.description) para(pr.description);
          for (const bl of pr.bullets) bullet(bl.text);
        });
        break;
      case 'certifications':
        if (!data.certifications.length) break;
        heading(s.title);
        for (const c of data.certifications) para([c.name, c.issuer, c.date].filter(Boolean).join(' | '));
        break;
      case 'custom': {
        const cs = data.custom_sections.find((c) => c.id === s.customId);
        if (!cs) break;
        heading(cs.title);
        for (const l of cs.lines) para(l.text);
        break;
      }
    }
  }
  return pdf.save();
}

function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}

function fit(text: string, font: PDFFont, size: number, maxW: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxW) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

export function sectionOrder(data: ResumeData): { section: SectionKey; title: string; customId: string | null }[] {
  const out: { section: SectionKey; title: string; customId: string | null }[] = data.headings
    .filter((h) => h.section !== 'header')
    .map((h) => ({ section: h.section, title: h.text, customId: h.customId }));
  const has = (s: SectionKey) => out.some((o) => o.section === s);
  if (data.summary.text && !has('summary')) out.unshift({ section: 'summary', title: 'Summary', customId: null });
  const defaults: [SectionKey, string, boolean][] = [
    ['experience', 'Experience', data.experience.length > 0],
    ['education', 'Education', data.education.length > 0],
    ['skills', 'Skills', data.skills.length > 0],
    ['projects', 'Projects', data.projects.length > 0],
    ['certifications', 'Certifications', data.certifications.length > 0],
  ];
  for (const [s, t, present] of defaults) if (present && !has(s)) out.push({ section: s, title: t, customId: null });
  for (const c of data.custom_sections) if (!out.some((o) => o.customId === c.id)) out.push({ section: 'custom', title: c.title, customId: c.id });
  // Deduplicate repeated headings of the same section (e.g. two "Experience" blocks were merged)
  const seen = new Set<string>();
  return out.filter((o) => {
    const k = o.section === 'custom' ? `c:${o.customId}` : o.section;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
