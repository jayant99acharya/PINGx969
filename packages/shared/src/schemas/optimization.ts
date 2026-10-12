import { z } from 'zod';
import { ResumeDataSchema } from './resume';
import { MatchResultSchema } from './match';

/**
 * Provenance of every proposed change. The optimizer must be able to justify each change
 * with evidence from the candidate's own material.
 *  - fact: directly supported by text in the resume/profile
 *  - inference: reasonable inference from the same role/project (shown for user review)
 *  - suggestion: needs information only the user has (never applied silently)
 *  - missing: a job requirement the candidate does not show — reported, never added
 *  - user_confirmed: the user explicitly confirmed they have this skill
 */
export const ProvenanceSchema = z.enum(['fact', 'inference', 'suggestion', 'missing', 'user_confirmed']);
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const ChangeKindSchema = z.enum([
  'skills_reordered',
  'skill_added',
  'skill_not_added',
  'bullet_rephrased',
  'bullets_reordered',
  'summary_generated',
  'summary_rephrased',
  'suggestion',
]);
export type ChangeKind = z.infer<typeof ChangeKindSchema>;

export const ChangeSchema = z.object({
  id: z.string(),
  kind: ChangeKindSchema,
  section: z.enum(['summary', 'skills', 'experience', 'projects']),
  target: z.object({
    experienceId: z.string().optional(),
    projectId: z.string().optional(),
    bulletId: z.string().optional(),
    skillGroupId: z.string().optional(),
    skill: z.string().optional(),
    /** bullets_reordered: bullet ids in the new order. */
    order: z.array(z.string()).optional(),
  }),
  before: z.union([z.string(), z.array(z.string())]).nullable(),
  after: z.union([z.string(), z.array(z.string())]).nullable(),
  provenance: ProvenanceSchema,
  evidence: z.array(z.string()).default([]),
  reason: z.string(),
  accepted: z.boolean(),
  /** Changes that never alter the document (e.g. "NOT ADDED" reports). */
  informational: z.boolean().default(false),
  /** Set when the fact guard rejected an AI proposal; such changes can't be accepted. */
  blocked: z.string().nullable().default(null),
  /** Text of a suggestion still containing a [placeholder] the user must fill. */
  hasPlaceholder: z.boolean().default(false),
  /** The user edited the proposed text (the user is the source of truth for their own claims). */
  edited: z.boolean().default(false),
  /** Which engine proposed the change (heuristic, anthropic, ...). */
  source: z.string().default('heuristic'),
});
export type Change = z.infer<typeof ChangeSchema>;

export const OptimizationResultSchema = z.object({
  changes: z.array(ChangeSchema),
  provider: z.string(),
  warnings: z.array(z.string()).default([]),
});
export type OptimizationResult = z.infer<typeof OptimizationResultSchema>;

export const VersionPayloadSchema = z.object({
  changes: z.array(ChangeSchema),
  optimized: ResumeDataSchema,
  matchBefore: MatchResultSchema,
  matchAfter: MatchResultSchema,
  provider: z.string(),
  warnings: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type VersionPayload = z.infer<typeof VersionPayloadSchema>;
