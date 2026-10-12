import { Router } from 'express';
import { z } from 'zod';
import {
  AppError,
  DEFAULT_WEIGHTS,
  ErrorCodes,
  ProfileSchema,
  ScoringWeightsSchema,
  mergeProfile,
} from '@pingx969/shared';
import { verifyPassword } from '@pingx969/database';
import { DIMENSION_INFO } from '@pingx969/resume-optimizer';
import { SESSION_COOKIE, body, uid } from '../middleware';
import type { AppContext } from '../context';

export function profileRoutes(ctx: AppContext): Router {
  const r = Router();
  r.get('/', async (req, res) => {
    res.json(await ctx.repos.getProfile(uid(req)));
  });
  r.put('/', async (req, res) => {
    const profile = ProfileSchema.parse(req.body?.profile ?? req.body);
    res.json({ profile, ...(await ctx.repos.saveProfile(uid(req), profile)) });
  });
  /** Partial update (deep merge). Every edit is persisted immediately. */
  r.patch('/', async (req, res) => {
    const userId = uid(req);
    const { profile } = await ctx.repos.getProfile(userId);
    const next = mergeProfile(profile, req.body ?? {});
    res.json({ profile: next, ...(await ctx.repos.saveProfile(userId, next)) });
  });
  return r;
}

export function settingsRoutes(ctx: AppContext): Router {
  const r = Router();
  r.get('/', async (req, res) => {
    const s = await ctx.repos.getSettings(uid(req));
    res.json({ settings: { ...s, scoringWeights: { ...DEFAULT_WEIGHTS, ...(s.scoringWeights ?? {}) } }, providers: ctx.availableProviders(), dimensions: DIMENSION_INFO });
  });
  r.put('/', async (req, res) => {
    const input = body(
      z.object({
        scoringWeights: ScoringWeightsSchema.partial().nullable().optional(),
        aiProvider: z.enum(['heuristic', 'anthropic']).optional(),
        autoLearn: z.boolean().optional(),
        showLauncher: z.boolean().optional(),
      }),
      req,
    );
    if (input.aiProvider && !ctx.availableProviders().find((p) => p.name === input.aiProvider)?.available) {
      throw new AppError(ErrorCodes.VALIDATION, 'That AI provider is not configured on this server.', 400);
    }
    if (input.scoringWeights && Object.values({ ...DEFAULT_WEIGHTS, ...input.scoringWeights }).every((w) => w === 0)) {
      throw new AppError(ErrorCodes.VALIDATION, 'At least one scoring weight must be above zero.', 400);
    }
    const s = await ctx.repos.updateSettings(uid(req), input);
    res.json({ settings: { ...s, scoringWeights: { ...DEFAULT_WEIGHTS, ...(s.scoringWeights ?? {}) } } });
  });
  return r;
}

export function accountRoutes(ctx: AppContext): Router {
  const r = Router();
  /** Export every piece of stored data (decrypted) as JSON. */
  r.get('/export', async (req, res) => {
    const userId = uid(req);
    const [user, profile, settings, resumes, jobs, versions, applications, answers, mappings] = await Promise.all([
      ctx.repos.getUser(userId),
      ctx.repos.getProfile(userId),
      ctx.repos.getSettings(userId),
      ctx.repos.listResumes(userId),
      ctx.repos.listJobs(userId),
      ctx.repos.listVersions(userId),
      ctx.repos.listApplications(userId),
      ctx.repos.listAnswers(userId),
      ctx.repos.listMappings(userId),
    ]);
    const fullResumes = await Promise.all(resumes.map(async (r0) => (await ctx.repos.getResume(userId, r0.id))!));
    const fullVersions = await Promise.all(versions.map(async (v) => (await ctx.repos.getVersion(userId, v.id))!));
    const fullJobs = await Promise.all(jobs.map(async (j) => (await ctx.repos.getJob(userId, j.id))!));
    const events = await Promise.all(applications.map(async (a) => ({ applicationId: a.id, events: await ctx.repos.listApplicationEvents(userId, a.id) })));
    res.setHeader('Content-Disposition', 'attachment; filename="pingx969-export.json"');
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      exportedAt: new Date().toISOString(),
      user: user ? { id: user.id, email: user.email, displayName: user.displayName, createdAt: user.createdAt } : null,
      profile: profile.profile,
      settings,
      resumes: fullResumes.map((x) => ({ id: x.id, name: x.name, sourceFormat: x.sourceFormat, createdAt: x.createdAt, data: x.parsed.data })),
      jobs: fullJobs,
      versions: fullVersions,
      applications,
      applicationEvents: events,
      savedAnswers: answers,
      fieldMappings: mappings,
    });
  });

  /** Permanently delete the account and all associated data and files. */
  r.delete('/', async (req, res) => {
    const userId = uid(req);
    const { password } = body(z.object({ password: z.string().min(1).max(200) }), req);
    const user = await ctx.repos.getUser(userId);
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw new AppError(ErrorCodes.UNAUTHORIZED, 'Password is incorrect.', 401);
    const keys = await ctx.repos.listDocumentKeys(userId);
    await ctx.repos.deleteUser(userId); // cascades to every table
    await Promise.all(keys.map((k) => ctx.store.delete(k).catch(() => undefined)));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });
  return r;
}

export function dashboardRoutes(ctx: AppContext): Router {
  const r = Router();
  r.get('/', async (req, res) => {
    const userId = uid(req);
    const [stats, applications, versions, resumes, answers] = await Promise.all([
      ctx.repos.applicationStats(userId),
      ctx.repos.listApplications(userId),
      ctx.repos.listVersions(userId),
      ctx.repos.listResumes(userId),
      ctx.repos.listAnswers(userId),
    ]);
    const avgVersionMatch = versions.length ? Math.round(versions.reduce((n, v) => n + v.matchAfter, 0) / versions.length) : null;
    res.json({
      stats: { ...stats, averageResumeMatch: avgVersionMatch, resumes: resumes.length, versions: versions.length, savedAnswers: answers.length },
      recentApplications: applications.slice(0, 6),
      recentVersions: versions.slice(0, 6),
    });
  });
  return r;
}

/** Everything the extension needs to autofill locally (fetched once per session, cached in memory). */
export function autofillRoutes(ctx: AppContext): Router {
  const r = Router();
  r.get('/bootstrap', async (req, res) => {
    const userId = uid(req);
    const [user, profile, answers, mappings, settings] = await Promise.all([
      ctx.repos.getUser(userId),
      ctx.repos.getProfile(userId),
      ctx.repos.listAnswers(userId),
      ctx.repos.listMappings(userId),
      ctx.repos.getSettings(userId),
    ]);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      user: user ? { id: user.id, email: user.email, displayName: user.displayName } : null,
      profile: profile.profile,
      profileVersion: profile.version,
      answers,
      mappings,
      settings: { autoLearn: settings.autoLearn, showLauncher: settings.showLauncher },
    });
  });

  /** Identify the job behind an application page and recommend the best resume version. */
  r.post('/page', async (req, res) => {
    const userId = uid(req);
    const input = body(z.object({ url: z.string().max(2048), company: z.string().max(300).default(''), title: z.string().max(300).default('') }), req);
    const job = await ctx.repos.findJobForPage(userId, input.url, input.company, input.title);
    const versions = job ? await ctx.repos.listVersions(userId, { jobId: job.id }) : [];
    const best = [...versions].sort((a, b) => b.matchAfter - a.matchAfter || b.createdAt.localeCompare(a.createdAt))[0] ?? null;
    const allVersions = (await ctx.repos.listVersions(userId)).slice(0, 20);
    const application = await ctx.repos.findApplicationByUrl(userId, input.url);
    const resumes = await ctx.repos.listResumes(userId);
    res.json({
      job,
      recommendedVersion: best,
      versions: job ? versions : [],
      otherVersions: allVersions.filter((v) => !versions.some((x) => x.id === v.id)).map((v) => ({ id: v.id, label: v.label, matchAfter: v.matchAfter })),
      defaultResume: resumes.find((x) => x.isDefault) ?? resumes[0] ?? null,
      application,
    });
  });
  return r;
}
