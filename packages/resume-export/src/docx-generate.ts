import {
  AlignmentType,
  BorderStyle,
  Document,
  LevelFormat,
  Packer,
  Paragraph,
  Tab,
  TabStopType,
  TextRun,
} from 'docx';
import { type LayoutProfile, LayoutProfileSchema, type ResumeData, formatDateForDisplay } from '@pingx969/shared';
import { sectionOrder } from './pdf-render';

const FONT_FOR: Record<LayoutProfile['fontFamily'], string> = { sans: 'Calibri', serif: 'Times New Roman', mono: 'Courier New' };

/**
 * Build an editable DOCX that mirrors a layout profile. Used when the source wasn't a DOCX
 * (PDF/TXT/MD/JSON) — DOCX sources are patched in place instead (see patchDocx).
 */
export async function generateDocx(data: ResumeData, layoutIn?: Partial<LayoutProfile>): Promise<Uint8Array> {
  const L = LayoutProfileSchema.parse({ margins: {}, ...(layoutIn ?? {}) });
  const font = L.fontNameHint && !/^[A-Z]{6}\+/.test(L.fontNameHint) && L.fontNameHint.length < 40 ? L.fontNameHint.replace(/[-,].*$/, '') : FONT_FOR[L.fontFamily];
  const half = (pt: number) => Math.round(pt * 2);
  const tw = (pt: number) => Math.round(pt * 20);
  const rightTab = tw(L.pageWidth - L.margins.left - L.margins.right);
  const children: Paragraph[] = [];
  const p = data.personal;
  const center = L.nameAlign === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT;

  children.push(new Paragraph({ alignment: center, children: [new TextRun({ text: L.nameUppercase ? (p.name || 'Your Name').toUpperCase() : p.name || 'Your Name', bold: true, size: half(L.nameSize) })] }));
  const contact = [p.location, p.email, p.phone, ...data.links.filter((l) => l.kind !== 'other').map((l) => l.url.replace(/^https?:\/\/(www\.)?/, ''))].filter(Boolean).join(' | ');
  if (contact) children.push(new Paragraph({ alignment: center, children: [new TextRun({ text: contact, size: half(L.contactSize) })] }));
  if (p.headline) children.push(new Paragraph({ alignment: center, children: [new TextRun({ text: p.headline, italics: true, size: half(L.contactSize) })] }));

  const heading = (t: string) =>
    new Paragraph({
      spacing: { before: tw(L.sectionSpacing), after: 60 },
      border: L.headingRule ? { bottom: { color: '808080', space: 1, style: BorderStyle.SINGLE, size: 6 } } : undefined,
      children: [new TextRun({ text: L.headingUppercase ? t.toUpperCase() : t, bold: L.headingBold, size: half(L.headingSize), color: L.headingColor.replace('#', '') })],
    });
  const bullet = (t: string) => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: [new TextRun(t)] });
  const header = (bold: string, rest: string, right: string) =>
    new Paragraph({
      spacing: { before: 80 },
      tabStops: [{ type: TabStopType.RIGHT, position: rightTab }],
      children: [new TextRun({ text: bold, bold: true }), new TextRun(rest), ...(right ? [new TextRun({ children: [new Tab(), right], italics: true })] : [])],
    });

  for (const s of sectionOrder(data)) {
    switch (s.section) {
      case 'summary':
        if (data.summary.text) children.push(heading(s.title), new Paragraph({ children: [new TextRun(data.summary.text)] }));
        break;
      case 'experience':
        if (!data.experience.length) break;
        children.push(heading(s.title));
        for (const e of data.experience) {
          const dates = e.dateText || [formatDateForDisplay(e.startDate), formatDateForDisplay(e.endDate)].filter(Boolean).join(' – ');
          children.push(header(e.title || e.company, [e.title ? e.company : '', e.location].filter(Boolean).map((x) => ` | ${x}`).join(''), dates));
          for (const b of e.bullets) children.push(bullet(b.text));
        }
        break;
      case 'education':
        if (!data.education.length) break;
        children.push(heading(s.title));
        for (const e of data.education) {
          const deg = [e.degree, e.field].filter(Boolean).join(', ');
          children.push(header(e.institution || deg, e.institution && deg ? ` | ${deg}` : '', e.dateText || formatDateForDisplay(e.endDate)));
          for (const d of e.details) children.push(bullet(d));
        }
        break;
      case 'skills':
        if (!data.skills.length) break;
        children.push(heading(s.title));
        for (const g of data.skills) {
          children.push(new Paragraph({ children: [...(g.category ? [new TextRun({ text: `${g.category}: `, bold: true })] : []), new TextRun(g.items.join(g.delimiter || ', '))] }));
        }
        break;
      case 'projects':
        if (!data.projects.length) break;
        children.push(heading(s.title));
        for (const pr of data.projects) {
          children.push(header(pr.name, pr.url ? ` | ${pr.url}` : '', pr.dateText));
          if (pr.description) children.push(new Paragraph({ children: [new TextRun(pr.description)] }));
          for (const b of pr.bullets) children.push(bullet(b.text));
        }
        break;
      case 'certifications':
        if (!data.certifications.length) break;
        children.push(heading(s.title));
        for (const c of data.certifications) children.push(new Paragraph({ children: [new TextRun([c.name, c.issuer, c.date].filter(Boolean).join(' | '))] }));
        break;
      case 'custom': {
        const cs = data.custom_sections.find((c) => c.id === s.customId);
        if (!cs) break;
        children.push(heading(cs.title));
        for (const l of cs.lines) children.push(new Paragraph({ children: [new TextRun(l.text)] }));
        break;
      }
    }
  }

  const doc = new Document({
    creator: 'PINGx969',
    title: `${p.name || 'Resume'}`,
    styles: { default: { document: { run: { font, size: half(L.bodySize) } } } },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: L.bulletGlyph && L.bulletGlyph !== 'numbered' ? L.bulletGlyph : '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 360, hanging: 240 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: tw(L.pageWidth), height: tw(L.pageHeight) },
            margin: { top: tw(L.margins.top), right: tw(L.margins.right), bottom: tw(L.margins.bottom), left: tw(L.margins.left) },
          },
        },
        children,
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}
