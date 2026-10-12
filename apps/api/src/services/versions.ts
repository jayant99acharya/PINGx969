import {
  AppError,
  type Change,
  ErrorCodes,
  type JobAnalysis,
  type ParsedResume,
  type VersionPayload,
  VersionPayloadSchema,
  getSkill,
} from '@pingx969/shared';
import { applyChanges, buildFactBase, matchResume, runOptimization, unfilledPlaceholders } from '@pingx969/resume-optimizer';
import type { AppContext } from '../context';
import { loadResume } from './resumes';

/** Versions remember the parser version of their base resume; edits require the same parse. */
export function sameParse(metadata: Record<string, unknown> | undefined, parserVersion: number | undefined): boolean {
  return Number(metadata?.parserVersion ?? 1) === (parserVersion ?? 1);
}

export function versionLabel(company: string, title: string, when = new Date()): string {
  const month = when.toLocaleString('en-US', { month: 'short', year: 'numeric' });
  return [company || 'Untitled company', title || 'Role', month].join(' — ');
}

async function matchOptions(ctx: AppContext, userId: string, parsed: ParsedResume) {
  const [{ profile }, settings] = await Promise.all([ctx.repos.getProfile(userId), ctx.repos.getSettings(userId)]);
  return {
    weights: settings.scoringWeights ?? undefined,
    confirmedSkills: profile.confirmedSkills,
    yearsOverride: profile.yearsOfExperienceOverride,
    document: parsed.document,
    settings,
  };
}

export async function computeMatch(ctx: AppContext, userId: string, parsed: ParsedResume, analysis: JobAnalysis) {
  const o = await matchOptions(ctx, userId, parsed);
  return matchResume(parsed.data, analysis, o);
}

export async function createOptimizedVersion(
  ctx: AppContext,
  userId: string,
  resumeId: string,
  jobId: string,
  opts: { provider?: string; consentExternal?: boolean; scope?: 'full' | 'skills' },
) {
  const scope = opts.scope ?? 'full';
  const resume = await loadResume(ctx, userId, resumeId);
  if (!resume) throw new AppError(ErrorCodes.NOT_FOUND, 'Resume not found.', 404);
  const job = await ctx.repos.getJob(userId, jobId);
  if (!job?.description) throw new AppError(ErrorCodes.NOT_FOUND, 'Job not found.', 404);
  const o = await matchOptions(ctx, userId, resume.parsed);
  const providerName = opts.provider || o.settings.aiProvider || 'heuristic';
  const provider = ctx.provider(providerName);
  if (provider.external && !opts.consentExternal && scope === 'full') {
    throw new AppError(ErrorCodes.VALIDATION, 'Using an external AI provider sends your resume content (with contact details removed) to that provider. Please confirm to continue.', 400, { needsConsent: true });
  }
  const analysis = job.description.analysis;
  const matchBefore = matchResume(resume.parsed.data, analysis, o);
  const started = Date.now();
  const outcome = await runOptimization(provider, { resume: resume.parsed.data, job: analysis, match: matchBefore, confirmedSkills: o.confirmedSkills, yearsOverride: o.yearsOverride, scope }, { timeoutMs: ctx.config.aiTimeoutMs });
  const optimized = applyChanges(resume.parsed.data, outcome.changes);
  const matchAfter = matchResume(optimized, analysis, o);
  const payload: VersionPayload = VersionPayloadSchema.parse({
    changes: outcome.changes,
    optimized,
    matchBefore,
    matchAfter,
    provider: outcome.provider,
    warnings: outcome.warnings,
    metadata: {
      requestedProvider: providerName,
      fellBack: outcome.fellBack,
      durationMs: Date.now() - started,
      jobTitle: analysis.title,
      company: analysis.company,
      resumeName: resume.name,
      sourceFormat: resume.sourceFormat,
      scope,
      parserVersion: resume.parsed.parserVersion ?? 1,
    },
  });
  const version = await ctx.repos.createVersion(userId, {
    resumeId,
    jobId,
    jobDescriptionId: job.description.id,
    label: versionLabel(job.company || analysis.company, job.title || analysis.title) + (scope === 'skills' ? ' · Skills only' : ''),
    company: job.company || analysis.company,
    jobTitle: job.title || analysis.title,
    jobUrl: job.url,
    matchBefore: matchBefore.overall,
    matchAfter: matchAfter.overall,
    provider: outcome.provider,
    payload,
  });
  await ctx.repos.recordRun(userId, {
    resumeId,
    jobDescriptionId: job.description.id,
    versionId: version.id,
    provider: outcome.provider,
    status: outcome.fellBack ? 'fallback' : 'succeeded',
    durationMs: Date.now() - started,
    warnings: outcome.warnings,
  });
  return { version, payload };
}

export interface Decision {
  id: string;
  accepted?: boolean;
  after?: string | string[];
  confirmSkill?: boolean;
}

/** Apply user accept/reject/edit decisions to a version and recompute the generated resume. */
export async function applyDecisions(ctx: AppContext, userId: string, versionId: string, decisions: Decision[], label?: string) {
  const version = await ctx.repos.getVersion(userId, versionId);
  if (!version) throw new AppError(ErrorCodes.NOT_FOUND, 'Version not found.', 404);
  const resume = await ctx.repos.getResume(userId, version.resumeId);
  if (!resume) throw new AppError(ErrorCodes.NOT_FOUND, 'The original resume for this version was deleted.', 404);
  if (!sameParse(version.payload.metadata, resume.parsed.parserVersion)) {
    throw new AppError(ErrorCodes.CONFLICT, 'This version was created with an older resume parser. Generate a new version for this job to edit it.', 409);
  }
  const job = version.jobId ? await ctx.repos.getJob(userId, version.jobId) : null;
  const changes: Change[] = structuredClone(version.payload.changes);
  const confirmed: string[] = [];

  for (const d of decisions) {
    const i = changes.findIndex((c) => c.id === d.id);
    if (i < 0) throw new AppError(ErrorCodes.VALIDATION, `Unknown change "${d.id}".`, 400);
    let c = changes[i];
    if (d.confirmSkill && c.kind === 'skill_not_added' && c.target.skill) {
      // The user explicitly confirmed they have this skill: add it, marked as user-confirmed.
      const skill = c.target.skill;
      const skillsOnly = version.payload.metadata?.scope === 'skills';
      const group = skillsOnly ? (resume.parsed.data.skills.at(-1)?.id ?? null) : pickGroup(resume.parsed.data.skills, skill);
      if (!group) throw new AppError(ErrorCodes.VALIDATION, 'This resume has no Skills section to add the skill to.', 400);
      confirmed.push(skill);
      c = {
        ...c,
        kind: 'skill_added',
        target: { skillGroupId: group, skill },
        after: skill,
        provenance: 'user_confirmed',
        evidence: ['You confirmed you have this skill'],
        reason: `Added because you confirmed you have ${skill}.`,
        accepted: true,
        informational: false,
        blocked: null,
      };
    }
    if (d.after !== undefined) {
      if (c.informational) throw new AppError(ErrorCodes.VALIDATION, 'This item cannot be edited.', 400);
      if (typeof c.after === 'string' && typeof d.after !== 'string') throw new AppError(ErrorCodes.VALIDATION, 'Expected text for this change.', 400);
      if (Array.isArray(c.after) && !Array.isArray(d.after)) throw new AppError(ErrorCodes.VALIDATION, 'Expected a list for this change.', 400);
      if (Array.isArray(d.after) && Array.isArray(c.before)) {
        const allowed = new Set(c.before.map((x) => x.toLowerCase()));
        if (d.after.length !== c.before.length || d.after.some((x) => !allowed.has(x.toLowerCase()))) {
          throw new AppError(ErrorCodes.VALIDATION, 'A reorder may only change the order of existing items.', 400);
        }
      }
      const text = typeof d.after === 'string' ? d.after.trim().slice(0, 2000) : d.after;
      c = { ...c, after: text, edited: true, blocked: null, hasPlaceholder: typeof text === 'string' && /\[[^\]]{2,80}\]/.test(text) };
      if (d.accepted === undefined) c.accepted = true;
    }
    if (d.accepted !== undefined) {
      if (d.accepted && c.blocked) throw new AppError(ErrorCodes.VALIDATION, 'This change was blocked because it is not supported by your resume. Edit the text to accept it.', 400);
      if (c.informational && d.accepted) throw new AppError(ErrorCodes.VALIDATION, 'This item is informational. Use "I have this skill" to add it.', 400);
      c = { ...c, accepted: d.accepted };
    }
    changes[i] = c;
  }

  if (confirmed.length) {
    const { profile } = await ctx.repos.getProfile(userId);
    for (const s of confirmed) if (!profile.confirmedSkills.includes(s)) profile.confirmedSkills.push(s);
    await ctx.repos.saveProfile(userId, profile);
  }
  const optimized = applyChanges(resume.parsed.data, changes);
  const o = await matchOptions(ctx, userId, resume.parsed);
  const analysis = job?.description?.analysis;
  const matchAfter = analysis ? matchResume(optimized, analysis, o) : version.payload.matchAfter;
  const payload: VersionPayload = { ...version.payload, changes, optimized, matchAfter };
  await ctx.repos.updateVersion(userId, versionId, { payload, matchAfter: matchAfter.overall, label });
  return { payload, placeholders: unfilledPlaceholders(changes).length };
}

function pickGroup(groups: ParsedResume['data']['skills'], skill: string): string | null {
  if (!groups.length) return null;
  const cat = getSkill(skill)?.cat;
  const byLabel = groups.find((g) => {
    const l = (g.category ?? '').toLowerCase();
    return (cat === 'language' && /language/.test(l)) || (cat === 'database' && /data|database|storage/.test(l)) || ((cat === 'cloud' || cat === 'devops') && /cloud|devops|tool|infra/.test(l)) || ((cat === 'frontend' || cat === 'backend') && /framework|librar/.test(l));
  });
  return (byLabel ?? groups[groups.length - 1]).id;
}

export function factSummary(parsed: ParsedResume, confirmedSkills: string[]) {
  const f = buildFactBase(parsed.data, { confirmedSkills });
  return { skills: [...f.skills.keys()], years: Math.round((f.months / 12) * 10) / 10, highestDegree: f.highestDegree };
}
