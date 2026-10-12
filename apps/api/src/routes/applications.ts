import { Router } from 'express';
import { z } from 'zod';
import { AppError, ApplicationStatusSchema, ErrorCodes } from '@pingx969/shared';
import { body, notFound, query, uid } from '../middleware';
import type { AppContext } from '../context';

const AppInput = z.object({
  company: z.string().trim().max(300).default(''),
  jobTitle: z.string().trim().max(300).default(''),
  jobUrl: z.string().trim().max(2048).default(''),
  status: ApplicationStatusSchema.default('saved'),
  jobId: z.string().uuid().nullable().optional(),
  resumeVersionId: z.string().uuid().nullable().optional(),
  matchScore: z.number().int().min(0).max(100).nullable().optional(),
  notes: z.string().max(10000).default(''),
});

/** Partial update: no defaults here — absent fields must stay untouched. */
const AppPatch = z.object({
  company: z.string().trim().max(300).optional(),
  jobTitle: z.string().trim().max(300).optional(),
  jobUrl: z.string().trim().max(2048).optional(),
  status: ApplicationStatusSchema.optional(),
  resumeVersionId: z.string().uuid().nullable().optional(),
  matchScore: z.number().int().min(0).max(100).nullable().optional(),
  notes: z.string().max(10000).optional(),
  confirmedSubmission: z.boolean().optional(),
});

export function applicationRoutes(ctx: AppContext): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const f = query(z.object({ status: ApplicationStatusSchema.optional(), q: z.string().max(200).optional() }), req);
    res.json({ applications: await ctx.repos.listApplications(uid(req), f) });
  });

  r.post('/', async (req, res) => {
    const input = body(AppInput, req);
    if (!input.company && !input.jobTitle && !input.jobUrl) throw new AppError(ErrorCodes.VALIDATION, 'Add at least a company, role, or job link.', 400);
    res.status(201).json({ application: await ctx.repos.createApplication(uid(req), input, { source: 'dashboard' }) });
  });

  /**
   * Extension: create or update the application for a job page when the user autofills.
   * Never marks an application "applied" — that requires the explicit confirm endpoint.
   */
  r.post('/upsert', async (req, res) => {
    const userId = uid(req);
    const input = body(
      z.object({
        jobUrl: z.string().trim().min(1).max(2048),
        company: z.string().trim().max(300).default(''),
        jobTitle: z.string().trim().max(300).default(''),
        jobId: z.string().uuid().nullable().optional(),
        resumeVersionId: z.string().uuid().nullable().optional(),
        matchScore: z.number().int().min(0).max(100).nullable().optional(),
        event: z.enum(['autofilled', 'opened', 'resume_attached']).default('autofilled'),
        fieldsFilled: z.number().int().min(0).max(1000).optional(),
      }),
      req,
    );
    const existing = await ctx.repos.findApplicationByUrl(userId, input.jobUrl);
    const data = { fieldsFilled: input.fieldsFilled ?? null, source: 'extension' };
    if (existing) {
      const updated = await ctx.repos.updateApplication(
        userId,
        existing.id,
        {
          status: existing.status === 'saved' ? 'preparing' : existing.status,
          company: existing.company || input.company,
          jobTitle: existing.jobTitle || input.jobTitle,
          resumeVersionId: input.resumeVersionId ?? existing.resumeVersionId,
          matchScore: input.matchScore ?? existing.matchScore,
        },
        input.event,
        data,
      );
      return res.json({ application: updated, created: false });
    }
    const application = await ctx.repos.createApplication(userId, { ...input, status: 'preparing' }, { ...data, event: input.event });
    res.status(201).json({ application, created: true });
  });

  r.get('/:id', async (req, res) => {
    const userId = uid(req);
    const application = await ctx.repos.getApplication(userId, String(req.params.id));
    if (!application) throw notFound('Application');
    res.json({ application, events: await ctx.repos.listApplicationEvents(userId, application.id) });
  });

  r.patch('/:id', async (req, res) => {
    const input = body(AppPatch, req);
    const { confirmedSubmission, ...patch } = input;
    const updated = await ctx.repos.updateApplication(uid(req), String(req.params.id), patch, 'updated', confirmedSubmission ? { confirmedBy: 'user' } : {});
    if (!updated) throw notFound('Application');
    res.json({ application: updated });
  });

  r.delete('/:id', async (req, res) => {
    if (!(await ctx.repos.deleteApplication(uid(req), String(req.params.id)))) throw notFound('Application');
    res.json({ ok: true });
  });

  return r;
}
