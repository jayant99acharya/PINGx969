import { z } from 'zod';

export const SeniorityLevels = [
  'intern',
  'junior',
  'mid',
  'senior',
  'staff',
  'principal',
  'lead',
  'manager',
  'director',
  'unknown',
] as const;
export const SenioritySchema = z.enum(SeniorityLevels);
export type Seniority = z.infer<typeof SenioritySchema>;

export const DegreeLevels = ['none', 'highschool', 'associate', 'bachelor', 'master', 'phd'] as const;
export const DegreeLevelSchema = z.enum(DegreeLevels);
export type DegreeLevel = z.infer<typeof DegreeLevelSchema>;

export const JobAnalysisSchema = z.object({
  title: z.string().default(''),
  company: z.string().default(''),
  seniority: SenioritySchema.default('unknown'),
  requiredSkills: z.array(z.string()).default([]),
  preferredSkills: z.array(z.string()).default([]),
  responsibilities: z.array(z.string()).default([]),
  qualifications: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  technologies: z.array(z.string()).default([]),
  domains: z.array(z.string()).default([]),
  education: z.object({
    level: DegreeLevelSchema.default('none'),
    fields: z.array(z.string()).default([]),
    required: z.boolean().default(false),
    equivalentExperienceOk: z.boolean().default(false),
    text: z.string().default(''),
  }),
  yearsExperience: z.object({
    min: z.number().nullable().default(null),
    max: z.number().nullable().default(null),
    text: z.string().default(''),
  }),
  location: z.string().default(''),
  workArrangement: z.enum(['remote', 'hybrid', 'onsite', 'unknown']).default('unknown'),
  employmentType: z.string().default(''),
  salary: z.string().default(''),
  otherRequirements: z.array(z.string()).default([]),
  /** Surface forms of skills exactly as written in the JD (canonical -> surface). */
  surfaceForms: z.record(z.string(), z.string()).default({}),
  /** Groups of interchangeable skills ("Java or Go"): having one satisfies the group. */
  skillAlternatives: z.array(z.array(z.string())).default([]),
  /** How many times each technology is mentioned (weights the Technology dimension). */
  technologyCounts: z.record(z.string(), z.number()).default({}),
  warnings: z.array(z.string()).default([]),
});
export type JobAnalysis = z.infer<typeof JobAnalysisSchema>;

export const JobInputSchema = z.object({
  text: z.string().max(60_000),
  url: z.string().max(2048).optional().default(''),
  title: z.string().max(300).optional().default(''),
  company: z.string().max(300).optional().default(''),
});
export type JobInput = z.infer<typeof JobInputSchema>;
