import { z } from 'zod';

export const DimensionKeys = [
  'skills',
  'experience',
  'responsibilities',
  'keywords',
  'education',
  'seniority',
  'technology',
  'domain',
  'ats',
] as const;
export const DimensionKeySchema = z.enum(DimensionKeys);
export type DimensionKey = z.infer<typeof DimensionKeySchema>;

export const DimensionLabels: Record<DimensionKey, string> = {
  skills: 'Skills',
  experience: 'Experience',
  responsibilities: 'Responsibilities',
  keywords: 'Keywords',
  education: 'Education',
  seniority: 'Seniority',
  technology: 'Technology',
  domain: 'Domain',
  ats: 'ATS compatibility',
};

export const ScoringWeightsSchema = z.object({
  skills: z.number().min(0).max(100),
  experience: z.number().min(0).max(100),
  responsibilities: z.number().min(0).max(100),
  keywords: z.number().min(0).max(100),
  education: z.number().min(0).max(100),
  seniority: z.number().min(0).max(100),
  technology: z.number().min(0).max(100),
  domain: z.number().min(0).max(100),
  ats: z.number().min(0).max(100),
});
export type ScoringWeights = z.infer<typeof ScoringWeightsSchema>;

export const DEFAULT_WEIGHTS: ScoringWeights = {
  skills: 25,
  experience: 15,
  responsibilities: 15,
  keywords: 10,
  education: 5,
  seniority: 10,
  technology: 10,
  domain: 5,
  ats: 5,
};

export const DimensionDescriptions: Record<DimensionKey, string> = {
  skills:
    'Required skills count fully, preferred skills count half. A skill is matched if it appears in your resume (or is implied, e.g. PostgreSQL implies SQL); related skills (e.g. GCP for an AWS role) earn partial credit as transferable.',
  experience:
    'Total months of professional experience computed from your dated roles (overlaps counted once) compared with the minimum years the job asks for.',
  responsibilities:
    'Each job responsibility is compared to your best-matching bullet using stemmed term overlap with action-verb synonyms. The score is the average best match.',
  keywords:
    'Important job terms (technologies and repeated domain phrases) checked for their exact wording in your resume — the way most ATS keyword filters work.',
  education: 'Your highest degree compared with the required degree level; "or equivalent experience" softens the requirement.',
  seniority: 'Level inferred from your most recent title and years of experience compared with the job level.',
  technology: 'Coverage of every technology mentioned anywhere in the job description, weighted by how often it appears.',
  domain: 'Industry/domain terminology (e.g. fintech, healthcare, e-commerce) shared by the job and your resume.',
  ats: 'Structural checks: contact info, standard section headings, parseable dates, bullet points, no layout tables or text boxes, reasonable length.',
};

export const SkillStatusSchema = z.enum(['matched', 'partial', 'missing', 'transferable']);
export type SkillStatus = z.infer<typeof SkillStatusSchema>;

export const SkillAssessmentSchema = z.object({
  skill: z.string(),
  required: z.boolean(),
  status: SkillStatusSchema,
  via: z.string().nullable().default(null),
  evidence: z.array(z.string()).default([]),
  inSkillsSection: z.boolean().default(false),
});
export type SkillAssessment = z.infer<typeof SkillAssessmentSchema>;

export const DimensionResultSchema = z.object({
  key: DimensionKeySchema,
  label: z.string(),
  score: z.number(),
  weight: z.number(),
  applicable: z.boolean(),
  summary: z.string(),
  details: z.array(
    z.object({
      label: z.string(),
      status: z.enum(['pass', 'partial', 'fail', 'info']),
      note: z.string().default(''),
    }),
  ),
});
export type DimensionResult = z.infer<typeof DimensionResultSchema>;

export const MatchResultSchema = z.object({
  overall: z.number(),
  dimensions: z.array(DimensionResultSchema),
  skills: z.array(SkillAssessmentSchema),
  weights: ScoringWeightsSchema,
  methodology: z.string(),
});
export type MatchResult = z.infer<typeof MatchResultSchema>;
