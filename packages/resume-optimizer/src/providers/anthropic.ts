import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import {
  AppError,
  type Change,
  ErrorCodes,
  type JobAnalysis,
  type JobInput,
  JobAnalysisSchema,
  type ParsedResume,
  type ResumeData,
  SenioritySchema,
  canonicalSkill,
} from '@pingx969/shared';
import { CANONICAL_QUESTIONS, type QuestionMapping, normalizeQuestion } from '@pingx969/profile';
import { HeuristicProvider } from './heuristic';
import { buildFactBase } from '../facts';
import type { AIProvider, OptimizationInput, ProviderOptimization, ResumeAnalysis } from './types';

export interface AnthropicProviderConfig {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Pre-built SDK client (tests inject a fake; production builds one from the settings above). */
  client?: Pick<Anthropic, 'beta'>;
}

// ---- Output schemas (structured outputs; re-validated with zod by the SDK) ----

const JobExtractionSchema = z.object({
  title: z.string(),
  company: z.string(),
  seniority: SenioritySchema,
  requiredSkills: z.array(z.string()),
  preferredSkills: z.array(z.string()),
  responsibilities: z.array(z.string()),
  qualifications: z.array(z.string()),
  yearsMin: z.number().nullable(),
  yearsMax: z.number().nullable(),
  educationLevel: z.enum(['none', 'highschool', 'associate', 'bachelor', 'master', 'phd']),
  educationRequired: z.boolean(),
  equivalentExperienceOk: z.boolean(),
  location: z.string(),
  workArrangement: z.enum(['remote', 'hybrid', 'onsite', 'unknown']),
  employmentType: z.string(),
  salary: z.string(),
  otherRequirements: z.array(z.string()),
});

const OptimizeSchema = z.object({
  summary: z.object({ text: z.string(), evidence: z.array(z.string()) }),
  bullets: z.array(
    z.object({
      bulletId: z.string(),
      text: z.string(),
      provenance: z.enum(['fact', 'inference']),
      evidence: z.array(z.string()),
      reason: z.string(),
    }),
  ),
});

const QuestionSchema = z.object({ canonicalQuestion: z.string(), confidence: z.number() });

const OPTIMIZE_SYSTEM = `You tailor resumes to job descriptions without ever fabricating anything.

Rules (strict):
- Use ONLY facts present in the candidate data. Never add employers, titles, dates, degrees, certifications, technologies, tools, metrics, numbers, team sizes, or achievements that are not in the source.
- You may rephrase, reorder words, use the job's terminology for a skill the candidate already has (e.g. "Postgres" -> "PostgreSQL"), and name a technology in a bullet only if that same role or project already mentions it elsewhere (mark these "inference").
- Never invent a metric. If a bullet would be stronger with a number the candidate did not provide, leave it as is.
- Keep each bullet about the same length as the original (at most ~40% longer), past tense for past roles, no first person.
- Every rewritten bullet must cite evidence: quote the source text it is based on.
- The summary (2-3 sentences) may use: most recent title, the provided total years of experience (do not exceed it), skills that appear in the candidate data, and achievements quoted from bullets.
- Only return bullets you actually changed. Use the exact bulletId values provided.`;

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  readonly external = true;
  readonly model: string;
  private client: Pick<Anthropic, 'beta'>;
  private local = new HeuristicProvider();
  private effort?: AnthropicProviderConfig['effort'];

  constructor(cfg: AnthropicProviderConfig = {}) {
    this.model = cfg.model || 'claude-opus-5';
    this.effort = cfg.effort;
    this.client =
      cfg.client ??
      new Anthropic({
        apiKey: cfg.apiKey,
        timeout: cfg.timeoutMs ?? 60_000,
        maxRetries: cfg.maxRetries ?? 2, // SDK retries 408/409/429/5xx and connection errors
      });
  }

  /** One structured-output call. Server-side refusal fallbacks are enabled ("default" routing). */
  private async call<T extends z.ZodType>(schema: T, system: string, user: string, maxTokens = 8000): Promise<z.infer<T>> {
    try {
      const response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { format: betaZodOutputFormat(schema), ...(this.effort ? { effort: this.effort } : {}) },
      });
      if (response.stop_reason === 'refusal') {
        throw new AppError(ErrorCodes.AI_FAILURE, 'The AI provider declined this request.', 502);
      }
      if (response.stop_reason === 'max_tokens') {
        throw new AppError(ErrorCodes.AI_FAILURE, 'The AI response was cut off before it finished.', 502);
      }
      if (response.parsed_output == null) {
        throw new AppError(ErrorCodes.AI_FAILURE, 'The AI provider returned a malformed response.', 502);
      }
      return response.parsed_output as z.infer<T>;
    } catch (e) {
      if (e instanceof AppError) throw e;
      if (e instanceof Anthropic.AuthenticationError) throw new AppError(ErrorCodes.AI_FAILURE, 'The AI provider rejected the API key.', 502);
      if (e instanceof Anthropic.RateLimitError) throw new AppError(ErrorCodes.AI_FAILURE, 'The AI provider is rate limiting requests. Try again shortly.', 503);
      if (e instanceof Anthropic.APIConnectionTimeoutError) throw new AppError(ErrorCodes.AI_FAILURE, 'The AI provider timed out.', 504);
      if (e instanceof Anthropic.APIConnectionError) throw new AppError(ErrorCodes.AI_FAILURE, 'Could not reach the AI provider.', 503);
      if (e instanceof Anthropic.APIError) throw new AppError(ErrorCodes.AI_FAILURE, `The AI provider returned an error (${e.status ?? 'unknown'}).`, 502);
      throw new AppError(ErrorCodes.AI_FAILURE, 'The AI response could not be validated.', 502, { cause: (e as Error)?.message });
    }
  }

  async analyzeJobDescription(input: JobInput): Promise<JobAnalysis> {
    const base = await this.local.analyzeJobDescription(input);
    const out = await this.call(
      JobExtractionSchema,
      'Extract structured requirements from a job description. Copy skills and responsibilities as written; do not infer requirements that are not stated. Use empty strings or null when information is absent.',
      `Job URL: ${input.url || 'n/a'}\n\nJob description:\n"""\n${input.text}\n"""`,
    );
    const canon = (xs: string[]) => [...new Set(xs.map((s) => canonicalSkill(s)).filter(Boolean))];
    const required = canon([...base.requiredSkills, ...out.requiredSkills]);
    const preferred = canon([...base.preferredSkills, ...out.preferredSkills]).filter((s) => !required.includes(s));
    return JobAnalysisSchema.parse({
      ...base,
      title: base.title || out.title,
      company: base.company || out.company,
      seniority: base.seniority === 'unknown' ? out.seniority : base.seniority,
      requiredSkills: required,
      preferredSkills: preferred,
      responsibilities: base.responsibilities.length >= out.responsibilities.length ? base.responsibilities : out.responsibilities,
      qualifications: base.qualifications.length >= out.qualifications.length ? base.qualifications : out.qualifications,
      yearsExperience: base.yearsExperience.min !== null ? base.yearsExperience : { min: out.yearsMin, max: out.yearsMax, text: out.yearsMin ? `${out.yearsMin}+ years` : '' },
      education: base.education.level !== 'none' ? base.education : { ...base.education, level: out.educationLevel, required: out.educationRequired, equivalentExperienceOk: out.equivalentExperienceOk },
      location: base.location || out.location,
      workArrangement: base.workArrangement === 'unknown' ? out.workArrangement : base.workArrangement,
      employmentType: base.employmentType || out.employmentType,
      salary: base.salary || out.salary,
      otherRequirements: base.otherRequirements.length ? base.otherRequirements : out.otherRequirements,
    });
  }

  async analyzeResume(input: ParsedResume, opts?: { confirmedSkills?: string[] }): Promise<ResumeAnalysis> {
    // Resume analysis is fully derivable from the parsed data; no need to transmit it.
    return this.local.analyzeResume(input, opts);
  }

  async optimizeResume(input: OptimizationInput): Promise<ProviderOptimization> {
    const local = await this.local.optimizeResume(input);
    if (input.scope === 'skills') return local; // skills-only needs no rewriting, so nothing is sent externally
    const payload = redactForAI(input.resume);
    const years = Math.floor(buildFactBase(input.resume, { yearsOverride: input.yearsOverride }).months / 12);
    const user = [
      `Total professional experience (computed from dated roles): ${years} years.`,
      `User-confirmed skills: ${input.confirmedSkills.join(', ') || 'none'}`,
      `Job: ${input.job.title} at ${input.job.company || 'the company'}`,
      `Required skills: ${input.job.requiredSkills.join(', ')}`,
      `Preferred skills: ${input.job.preferredSkills.join(', ')}`,
      `Responsibilities:\n- ${input.job.responsibilities.join('\n- ')}`,
      `Skills the candidate does NOT have (never add these): ${input.match.skills.filter((s) => s.status !== 'matched').map((s) => s.skill).join(', ') || 'none'}`,
      `Candidate data (contact details removed):\n${JSON.stringify(payload, null, 1)}`,
    ].join('\n\n');
    const out = await this.call(OptimizeSchema, OPTIMIZE_SYSTEM, user, 12000);

    const bulletIndex = new Map<string, { text: string; section: 'experience' | 'projects'; parentId: string }>();
    for (const e of input.resume.experience) for (const b of e.bullets) bulletIndex.set(b.id, { text: b.text, section: 'experience', parentId: e.id });
    for (const p of input.resume.projects) for (const b of p.bullets) bulletIndex.set(b.id, { text: b.text, section: 'projects', parentId: p.id });

    const aiChanges: Change[] = [];
    for (const b of out.bullets) {
      const src = bulletIndex.get(b.bulletId);
      if (!src || src.text.trim() === b.text.trim()) continue;
      aiChanges.push({
        id: `ai-bul-${b.bulletId}`,
        kind: 'bullet_rephrased',
        section: src.section,
        target: src.section === 'experience' ? { experienceId: src.parentId, bulletId: b.bulletId } : { projectId: src.parentId, bulletId: b.bulletId },
        before: src.text,
        after: b.text.trim(),
        provenance: b.provenance,
        evidence: b.evidence.slice(0, 4),
        reason: b.reason || 'Rephrased to emphasize relevant experience',
        accepted: true,
        informational: false,
        blocked: null,
        hasPlaceholder: false,
        edited: false,
        source: 'anthropic',
      });
    }
    // AI rewrites replace the local rewrite for the same bullet; everything else (skills, ordering, missing-skill report) stays deterministic.
    const aiBulletIds = new Set(aiChanges.map((c) => c.target.bulletId));
    const changes = local.changes.filter((c) => !(c.kind === 'bullet_rephrased' && aiBulletIds.has(c.target.bulletId)));
    if (out.summary.text.trim()) {
      const idx = changes.findIndex((c) => c.kind === 'summary_generated' || c.kind === 'summary_rephrased');
      const had = input.resume.summary.text.trim();
      const aiSummary: Change = {
        id: 'ai-summary',
        kind: had ? 'summary_rephrased' : 'summary_generated',
        section: 'summary',
        target: {},
        before: had || null,
        after: out.summary.text.trim(),
        provenance: 'fact',
        evidence: out.summary.evidence.slice(0, 6),
        reason: 'Job-specific summary written from facts in your resume',
        accepted: true,
        informational: false,
        blocked: null,
        hasPlaceholder: false,
        edited: false,
        source: 'anthropic',
      };
      if (idx >= 0) {
        // keep the local summary as a non-accepted alternative
        changes[idx] = { ...changes[idx], accepted: false, reason: `${changes[idx].reason} (alternative to the AI-written summary)` };
      }
      changes.unshift(aiSummary);
    }
    return { changes: [...changes, ...aiChanges], warnings: [] };
  }

  async normalizeQuestion(input: string): Promise<QuestionMapping> {
    const local = normalizeQuestion(input);
    if (!local.key.startsWith('custom:')) return local;
    const out = await this.call(
      QuestionSchema,
      'Map a job-application screening question to one of the canonical questions if, and only if, it asks the same thing (same meaning and same country). Otherwise answer "NONE". Return the canonical question text exactly as listed.',
      `Canonical questions:\n${CANONICAL_QUESTIONS.map((q) => `- ${q}`).join('\n')}\n\nQuestion: ${input}`,
      1000,
    );
    if (out.canonicalQuestion === 'NONE' || !CANONICAL_QUESTIONS.includes(out.canonicalQuestion) || out.confidence < 0.7) return local;
    const mapped = normalizeQuestion(out.canonicalQuestion);
    return { ...mapped, confidence: Math.min(0.9, out.confidence) };
  }
}

/** Remove direct identifiers before sending resume content to an external AI provider. */
export function redactForAI(data: ResumeData) {
  return {
    headline: data.personal.headline,
    summary: data.summary.text,
    experience: data.experience.map((e) => ({
      id: e.id,
      title: e.title,
      company: e.company,
      dates: e.dateText || `${e.startDate}–${e.endDate}`,
      technologies: e.technologies,
      bullets: e.bullets.map((b) => ({ bulletId: b.id, text: b.text })),
    })),
    projects: data.projects.map((p) => ({ id: p.id, name: p.name, technologies: p.technologies, bullets: p.bullets.map((b) => ({ bulletId: b.id, text: b.text })) })),
    skills: data.skills.map((g) => ({ category: g.category, items: g.items })),
    education: data.education.map((e) => ({ degree: e.degree, field: e.field })),
    certifications: data.certifications.map((c) => c.name),
  };
}
