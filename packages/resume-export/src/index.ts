import type { ParsedResume, ResumeData, ResumeFormat } from '@pingx969/shared';
import { patchDocx } from './docx-patch';
import { generateDocx } from './docx-generate';
import { renderPdf } from './pdf-render';
import { patchText } from './text-export';
import { appendSkillsInPlace } from './pdf-append';

export { patchDocx } from './docx-patch';
export { generateDocx } from './docx-generate';
export { renderPdf, sectionOrder } from './pdf-render';
export { patchText } from './text-export';
export { computeEdits, replaceBulletText, replaceSkillSpan } from './edits';
export { toJsonResume } from './json';
export { appendSkillsInPlace, appendedSkills } from './pdf-append';

export type ExportFormat = 'pdf' | 'docx' | 'json' | 'txt' | 'md';

export const EXPORT_MIME: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  json: 'application/json',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
};

export interface ExportInput {
  format: ExportFormat;
  source: ParsedResume;
  sourceFormat: ResumeFormat;
  /** Original uploaded bytes (needed to patch DOCX/TXT/MD in place). */
  originalBytes: Uint8Array | null;
  optimized: ResumeData;
  title?: string;
}

export interface ExportResult {
  bytes: Uint8Array;
  mime: string;
  extension: ExportFormat;
  /** How faithfully the original format was preserved. */
  fidelity: 'original-patched' | 'layout-matched' | 'structured';
  warnings: string[];
}

/** Which export formats preserve the original document, and how. */
export function exportCapabilities(sourceFormat: ResumeFormat): { format: ExportFormat; fidelity: ExportResult['fidelity']; note: string }[] {
  const caps: { format: ExportFormat; fidelity: ExportResult['fidelity']; note: string }[] = [];
  if (sourceFormat === 'docx') caps.push({ format: 'docx', fidelity: 'original-patched', note: 'Your original Word file with only the changed text edited — layout, fonts and spacing preserved.' });
  else caps.push({ format: 'docx', fidelity: 'layout-matched', note: 'Editable Word file recreated with your original page size, margins, fonts and heading style.' });
  caps.push({
    format: 'pdf',
    fidelity: 'layout-matched',
    note:
      sourceFormat === 'pdf'
        ? 'Skills-only versions: your original PDF with the new skills inserted in place. Full tailoring: re-rendered with your PDF\'s page size, margins, font sizes and section order.'
        : 'PDF rendered with your document\'s layout profile.',
  });
  if (sourceFormat === 'txt' || sourceFormat === 'md') caps.push({ format: sourceFormat, fidelity: 'original-patched', note: 'Your original file with only the changed lines rewritten.' });
  caps.push({ format: 'json', fidelity: 'structured', note: 'Structured resume data (JSON).' });
  return caps;
}

export async function exportResume(input: ExportInput): Promise<ExportResult> {
  const { format, source, optimized } = input;
  const layout = source.document.layout;
  const warnings: string[] = [];
  switch (format) {
    case 'docx': {
      if (input.sourceFormat === 'docx' && input.originalBytes) {
        const r = await patchDocx(input.originalBytes, source.document, source.data, optimized);
        return { bytes: r.bytes, mime: EXPORT_MIME.docx, extension: 'docx', fidelity: 'original-patched', warnings: r.warnings };
      }
      return { bytes: await generateDocx(optimized, layout), mime: EXPORT_MIME.docx, extension: 'docx', fidelity: 'layout-matched', warnings };
    }
    case 'pdf': {
      // Skills-only changes to a PDF: keep the original pages and insert the skills in place.
      if (input.sourceFormat === 'pdf' && input.originalBytes) {
        const inPlace = await appendSkillsInPlace(input.originalBytes, source.document, source.data, optimized);
        if (inPlace) return { bytes: inPlace.bytes, mime: EXPORT_MIME.pdf, extension: 'pdf', fidelity: 'original-patched', warnings: inPlace.warnings };
        warnings.push('Changes beyond the Skills section require re-rendering the PDF; choose "Skills only" to keep your original PDF design.');
      }
      if (layout.columns > 1) warnings.push('Your original uses multiple columns; the PDF is rendered as a single column (more ATS-friendly).');
      return { bytes: await renderPdf(optimized, layout, { title: input.title }), mime: EXPORT_MIME.pdf, extension: 'pdf', fidelity: 'layout-matched', warnings };
    }
    case 'txt':
    case 'md': {
      if ((input.sourceFormat === 'txt' || input.sourceFormat === 'md') && input.originalBytes) {
        const text = Buffer.from(input.originalBytes).toString('utf8').replace(/^\ufeff/, '');
        const r = patchText(text, source.document, source.data, optimized);
        return { bytes: new TextEncoder().encode(r.text), mime: EXPORT_MIME[format], extension: format, fidelity: 'original-patched', warnings: r.warnings };
      }
      const { renderPlainText } = await import('@pingx969/resume-parser');
      return { bytes: new TextEncoder().encode(renderPlainText(optimized).text), mime: EXPORT_MIME[format], extension: format, fidelity: 'structured', warnings };
    }
    case 'json': {
      const clean = stripLineRefs(optimized);
      return { bytes: new TextEncoder().encode(JSON.stringify({ format: 'pingx969/v1', resume: clean }, null, 2)), mime: EXPORT_MIME.json, extension: 'json', fidelity: 'structured', warnings };
    }
  }
}

/** Public JSON export without internal source-line bookkeeping. */
export function stripLineRefs(data: ResumeData) {
  return {
    personal: { name: data.personal.name, firstName: data.personal.firstName, lastName: data.personal.lastName, email: data.personal.email, phone: data.personal.phone, location: data.personal.location, headline: data.personal.headline },
    summary: data.summary.text,
    experience: data.experience.map((e) => ({ title: e.title, company: e.company, location: e.location, startDate: e.startDate, endDate: e.endDate, bullets: e.bullets.map((b) => b.text), technologies: e.technologies })),
    education: data.education.map((e) => ({ institution: e.institution, degree: e.degree, field: e.field, startDate: e.startDate, endDate: e.endDate, gpa: e.gpa, details: e.details })),
    skills: data.skills.map((g) => ({ category: g.category, items: g.items })),
    projects: data.projects.map((p) => ({ name: p.name, description: p.description, url: p.url, bullets: p.bullets.map((b) => b.text), technologies: p.technologies })),
    certifications: data.certifications.map((c) => ({ name: c.name, issuer: c.issuer, date: c.date })),
    links: data.links,
    custom_sections: data.custom_sections.map((c) => ({ title: c.title, lines: c.lines.map((l) => l.text) })),
  };
}
