import {
  AppError,
  ErrorCodes,
  type ParsedResume,
  type ResumeData,
  type ResumeDocument,
  type ResumeFormat,
  formatDateForDisplay,
  uniqueSkillNames,
} from '@pingx969/shared';
import { extractDocx } from './extract-docx';
import { extractPdf } from './extract-pdf';
import { extractText } from './extract-text';
import { importResumeJson } from './extract-json';
import { segmentResume } from './segment';

export { segmentResume, parseEntryHeader, headingSection, isLocation } from './segment';
export { extractDocx, loadDocxZip } from './extract-docx';
export { extractPdf } from './extract-pdf';
export { extractText, cleanLineText, BULLET_RE } from './extract-text';
export { importResumeJson } from './extract-json';
export * from './docx-model';
export * from './xml';
export { classifyFontFamily } from './fonts';

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

/** Bumped whenever parsing output changes; stored resumes from older parsers are re-parsed. */
export const PARSER_VERSION = 2;

export const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md', '.markdown', '.json'];

/** Detect the real file type from magic bytes (never trust the extension or client MIME alone). */
export function detectFormat(buf: Uint8Array, filename: string): ResumeFormat {
  const ext = (filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '').trim();
  const head = Buffer.from(buf.subarray(0, 1024)).toString('latin1');
  if (head.includes('%PDF-')) return 'pdf';
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    if (ext === '.docx' || ext === '' || ext === '.zip') return 'docx';
    throw new AppError(ErrorCodes.UNSUPPORTED_FILE, 'This archive is not a supported resume file. Upload PDF, DOCX, TXT, Markdown, or JSON.', 415);
  }
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) {
    throw new AppError(ErrorCodes.UNSUPPORTED_FILE, 'Legacy Word .doc files are not supported. Please save it as .docx or PDF and upload again.', 415);
  }
  // Text-like formats: must decode as UTF-8 without NUL bytes.
  if (buf.subarray(0, 4096).includes(0)) {
    throw new AppError(ErrorCodes.UNSUPPORTED_FILE, 'Unsupported file type. Upload PDF, DOCX, TXT, Markdown, or JSON.', 415);
  }
  const text = Buffer.from(buf.subarray(0, 2048)).toString('utf8').trimStart();
  if (ext === '.json' || (text.startsWith('{') && ext !== '.txt' && ext !== '.md')) return 'json';
  if (ext === '.md' || ext === '.markdown') return 'md';
  if (ext === '.txt' || ext === '' || ext === '.text') return 'txt';
  throw new AppError(ErrorCodes.UNSUPPORTED_FILE, `Files of type "${ext}" are not supported. Upload PDF, DOCX, TXT, Markdown, or JSON.`, 415);
}

export async function parseResume(buf: Uint8Array, filename: string): Promise<ParsedResume> {
  if (!buf.length) throw new AppError(ErrorCodes.EMPTY_RESUME, 'The uploaded file is empty.', 422);
  if (buf.length > MAX_RESUME_BYTES) throw new AppError(ErrorCodes.FILE_TOO_LARGE, 'Resume files must be 5 MB or smaller.', 413);
  const format = detectFormat(buf, filename);
  let document: ResumeDocument;
  if (format === 'pdf') document = await extractPdf(buf);
  else if (format === 'docx') document = await extractDocx(buf);
  else if (format === 'json') {
    const { data } = importResumeJson(Buffer.from(buf).toString('utf8'));
    return fromStructured(data, 'json');
  } else {
    const text = Buffer.from(buf).toString('utf8').replace(/^\ufeff/, '');
    document = extractText(text, format);
  }
  const rawText = document.lines.map((l) => l.text).join('\n');
  if (rawText.replace(/\s/g, '').length < 30) {
    throw new AppError(ErrorCodes.EMPTY_RESUME, 'The resume appears to be empty or has too little text to analyze.', 422);
  }
  const { data, warnings } = segmentResume(document);
  document.warnings.push(...warnings);
  return { document, data, rawText, parserVersion: PARSER_VERSION };
}

/** Build a ParsedResume from already-structured data (JSON import, or profile-built resumes). */
export function fromStructured(data: ResumeData, format: ResumeFormat = 'json'): ParsedResume {
  const { text, data: withLines } = renderPlainText(data);
  for (const e of withLines.experience) {
    if (!e.technologies.length) e.technologies = uniqueSkillNames([e.title, ...e.bullets.map((b) => b.text)].join(' . '));
  }
  for (const p of withLines.projects) {
    if (!p.technologies.length) p.technologies = uniqueSkillNames([p.name, p.description, ...p.bullets.map((b) => b.text)].join(' . '));
  }
  const document = extractText(text, 'txt');
  document.format = format;
  document.layout.fontFamily = 'sans';
  return { document, data: withLines, rawText: text, parserVersion: PARSER_VERSION };
}

/** Plain-text rendition of ResumeData; records line indices back into a copy of the data. */
export function renderPlainText(input: ResumeData): { text: string; data: ResumeData } {
  const data: ResumeData = structuredClone(input);
  const out: string[] = [];
  const push = (s: string) => {
    out.push(s);
    return out.length - 1;
  };
  const p = data.personal;
  if (p.name) p.nameLine = push(p.name);
  const contact = [p.email, p.phone, p.location, ...data.links.map((l) => l.url)].filter(Boolean);
  p.contactLines = contact.length ? [push(contact.join(' | '))] : [];
  if (p.headline) push(p.headline);
  data.headings = [];
  const heading = (section: (typeof data.headings)[number]['section'], title: string, customId: string | null = null) => {
    push('');
    const line = push(title.toUpperCase());
    data.headings.push({ section, text: title, line, customId });
  };
  if (data.summary.text) {
    heading('summary', 'Summary');
    data.summary.lines = [push(data.summary.text)];
  }
  if (data.experience.length) {
    heading('experience', 'Experience');
    data.experience.forEach((e, i) => {
      if (i) push('');
      const dates = [formatDateForDisplay(e.startDate), formatDateForDisplay(e.endDate)].filter(Boolean).join(' – ');
      e.dateText ||= dates;
      e.headerLines = [push([e.title, e.company, e.location, e.dateText].filter(Boolean).join(' | '))];
      e.bullets.forEach((b) => (b.line = push(`• ${b.text}`)));
    });
  }
  if (data.education.length) {
    heading('education', 'Education');
    for (const e of data.education) {
      const dates = [formatDateForDisplay(e.startDate), formatDateForDisplay(e.endDate)].filter(Boolean).join(' – ');
      e.dateText ||= dates;
      const deg = [e.degree, e.field].filter(Boolean).join(', ');
      e.lines = [push([e.institution, deg, e.dateText, e.gpa ? `GPA ${e.gpa}` : ''].filter(Boolean).join(' | '))];
      for (const d of e.details) e.lines.push(push(`• ${d}`));
    }
  }
  if (data.skills.length) {
    heading('skills', 'Skills');
    for (const g of data.skills) g.line = push(`${g.category ? `${g.category}: ` : ''}${g.items.join(g.delimiter || ', ')}`);
  }
  if (data.projects.length) {
    heading('projects', 'Projects');
    data.projects.forEach((pr, i) => {
      if (i) push('');
      pr.headerLines = [push([pr.name, pr.url, pr.dateText].filter(Boolean).join(' | '))];
      if (pr.description) push(pr.description);
      pr.bullets.forEach((b) => (b.line = push(`• ${b.text}`)));
    });
  }
  if (data.certifications.length) {
    heading('certifications', 'Certifications');
    for (const c of data.certifications) c.line = push([c.name, c.issuer, c.date].filter(Boolean).join(' | '));
  }
  for (const cs of data.custom_sections) {
    heading('custom', cs.title, cs.id);
    for (const l of cs.lines) l.line = push(l.text);
  }
  return { text: out.join('\n') + '\n', data };
}
