import { z } from 'zod';

/**
 * Normalized resume representation. Every element that originated from the source file
 * keeps `line` — an index into `ResumeDocument.lines` — so exporters can write changes back
 * into the original document (DOCX paragraph, text line, PDF line) instead of re-templating.
 */

export const ResumeFormatSchema = z.enum(['pdf', 'docx', 'txt', 'md', 'json']);
export type ResumeFormat = z.infer<typeof ResumeFormatSchema>;

export const BulletSchema = z.object({
  id: z.string(),
  text: z.string(),
  line: z.number().int().nullable(),
});
export type Bullet = z.infer<typeof BulletSchema>;

export const PersonalSchema = z.object({
  name: z.string().default(''),
  firstName: z.string().default(''),
  lastName: z.string().default(''),
  email: z.string().default(''),
  phone: z.string().default(''),
  location: z.string().default(''),
  headline: z.string().default(''),
  nameLine: z.number().int().nullable().default(null),
  contactLines: z.array(z.number().int()).default([]),
});
export type Personal = z.infer<typeof PersonalSchema>;

export const LinkSchema = z.object({
  kind: z.enum(['linkedin', 'github', 'portfolio', 'website', 'other']),
  label: z.string().default(''),
  url: z.string(),
});
export type ResumeLink = z.infer<typeof LinkSchema>;

export const ExperienceSchema = z.object({
  id: z.string(),
  title: z.string().default(''),
  company: z.string().default(''),
  location: z.string().default(''),
  startDate: z.string().default(''), // YYYY-MM or YYYY
  endDate: z.string().default(''), // YYYY-MM, YYYY, 'present' or ''
  dateText: z.string().default(''),
  headerLines: z.array(z.number().int()).default([]),
  bullets: z.array(BulletSchema).default([]),
  technologies: z.array(z.string()).default([]),
});
export type Experience = z.infer<typeof ExperienceSchema>;

export const EducationSchema = z.object({
  id: z.string(),
  institution: z.string().default(''),
  degree: z.string().default(''),
  field: z.string().default(''),
  startDate: z.string().default(''),
  endDate: z.string().default(''),
  dateText: z.string().default(''),
  gpa: z.string().default(''),
  details: z.array(z.string()).default([]),
  lines: z.array(z.number().int()).default([]),
});
export type Education = z.infer<typeof EducationSchema>;

export const SkillGroupSchema = z.object({
  id: z.string(),
  category: z.string().nullable().default(null),
  items: z.array(z.string()).default([]),
  line: z.number().int().nullable().default(null),
  /** Every source line the group spans (wrapped rows), first = `line`. */
  lines: z.array(z.number().int()).default([]),
  delimiter: z.string().default(', '),
});
export type SkillGroup = z.infer<typeof SkillGroupSchema>;

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string().default(''),
  description: z.string().default(''),
  url: z.string().default(''),
  dateText: z.string().default(''),
  bullets: z.array(BulletSchema).default([]),
  technologies: z.array(z.string()).default([]),
  headerLines: z.array(z.number().int()).default([]),
});
export type Project = z.infer<typeof ProjectSchema>;

export const CertificationSchema = z.object({
  id: z.string(),
  name: z.string(),
  issuer: z.string().default(''),
  date: z.string().default(''),
  line: z.number().int().nullable().default(null),
});
export type Certification = z.infer<typeof CertificationSchema>;

export const CustomSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  lines: z.array(z.object({ text: z.string(), line: z.number().int().nullable() })).default([]),
});
export type CustomSection = z.infer<typeof CustomSectionSchema>;

export const SectionKeySchema = z.enum([
  'header',
  'summary',
  'experience',
  'education',
  'skills',
  'projects',
  'certifications',
  'custom',
]);
export type SectionKey = z.infer<typeof SectionKeySchema>;

export const HeadingSchema = z.object({
  section: SectionKeySchema,
  customId: z.string().nullable().default(null),
  text: z.string(),
  line: z.number().int().nullable(),
});
export type Heading = z.infer<typeof HeadingSchema>;

export const ResumeDataSchema = z.object({
  personal: PersonalSchema,
  summary: z.object({ text: z.string().default(''), lines: z.array(z.number().int()).default([]) }),
  experience: z.array(ExperienceSchema).default([]),
  education: z.array(EducationSchema).default([]),
  skills: z.array(SkillGroupSchema).default([]),
  projects: z.array(ProjectSchema).default([]),
  certifications: z.array(CertificationSchema).default([]),
  links: z.array(LinkSchema).default([]),
  custom_sections: z.array(CustomSectionSchema).default([]),
  headings: z.array(HeadingSchema).default([]),
});
export type ResumeData = z.infer<typeof ResumeDataSchema>;

/** One logical line/paragraph of the source document with formatting hints. */
export const SourceLineSchema = z.object({
  text: z.string(),
  bullet: z.boolean().default(false),
  bulletGlyph: z.string().default(''),
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
  fontSize: z.number().nullable().default(null),
  fontName: z.string().default(''),
  align: z.enum(['left', 'center', 'right', 'justify']).default('left'),
  styleId: z.string().default(''),
  headingStyle: z.boolean().default(false),
  /** DOCX: index of the w:p element in document order. */
  paragraph: z.number().int().nullable().default(null),
  inTable: z.boolean().default(false),
  /** PDF: page index and baseline position (points from top). */
  page: z.number().int().nullable().default(null),
  x: z.number().nullable().default(null),
  y: z.number().nullable().default(null),
  /** For rule lines drawn under headings in PDFs. */
  ruleBelow: z.boolean().default(false),
  /** PDF: first baseline (y is the last baseline for wrapped lines), right edge, and the x of each tab-separated column. */
  yFirst: z.number().nullable().default(null),
  right: z.number().nullable().default(null),
  /** PDF: right edge of the last visual line (wrapped lines) and its text. */
  lastRight: z.number().nullable().default(null),
  lastText: z.string().default(''),
  tabX: z.array(z.number()).default([]),
  /** Number of physical source lines merged into this logical line (wrapped bullets). */
  span: z.number().int().default(1),
  /** TXT/MD: physical line index of the first line; leading indentation preserved for rewrites. */
  sourceLine: z.number().int().nullable().default(null),
  indent: z.string().default(''),
});
export type SourceLine = z.infer<typeof SourceLineSchema>;

export const LayoutProfileSchema = z.object({
  pageWidth: z.number().default(612),
  pageHeight: z.number().default(792),
  margins: z.object({
    top: z.number().default(54),
    right: z.number().default(54),
    bottom: z.number().default(54),
    left: z.number().default(54),
  }),
  fontFamily: z.enum(['sans', 'serif', 'mono']).default('sans'),
  fontNameHint: z.string().default(''),
  nameSize: z.number().default(20),
  headingSize: z.number().default(12),
  bodySize: z.number().default(10.5),
  contactSize: z.number().default(10),
  nameAlign: z.enum(['left', 'center']).default('left'),
  /** The name is typeset in capitals in the original. */
  nameUppercase: z.boolean().default(false),
  headingUppercase: z.boolean().default(true),
  headingBold: z.boolean().default(true),
  headingRule: z.boolean().default(false),
  headingColor: z.string().default('#000000'),
  bulletGlyph: z.string().default('•'),
  lineHeight: z.number().default(1.25),
  sectionSpacing: z.number().default(10),
  columns: z.number().int().default(1),
  pageCount: z.number().int().default(1),
});
export type LayoutProfile = z.infer<typeof LayoutProfileSchema>;

export const ResumeDocumentSchema = z.object({
  format: ResumeFormatSchema,
  lines: z.array(SourceLineSchema),
  layout: LayoutProfileSchema,
  warnings: z.array(z.string()).default([]),
  /** Structural facts used by the ATS compatibility check. */
  structure: z.object({
    hasTables: z.boolean().default(false),
    hasImages: z.boolean().default(false),
    hasTextBoxes: z.boolean().default(false),
    hasHeaderFooterText: z.boolean().default(false),
    multiColumn: z.boolean().default(false),
    pageCount: z.number().int().default(1),
  }),
});
export type ResumeDocument = z.infer<typeof ResumeDocumentSchema>;

export const ParsedResumeSchema = z.object({
  document: ResumeDocumentSchema,
  data: ResumeDataSchema,
  rawText: z.string(),
  parserVersion: z.number().int().default(1),
});
export type ParsedResume = z.infer<typeof ParsedResumeSchema>;

export function emptyResumeData(): ResumeData {
  return ResumeDataSchema.parse({ personal: {}, summary: {} });
}

export function flattenSkills(data: Pick<ResumeData, 'skills'>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const g of data.skills) {
    for (const s of g.items) {
      const k = s.trim().toLowerCase();
      if (k && !seen.has(k)) {
        seen.add(k);
        out.push(s.trim());
      }
    }
  }
  return out;
}
