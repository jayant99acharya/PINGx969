import { Router } from 'express';
import { z } from 'zod';
import { AppError, ErrorCodes } from '@pingx969/shared';
import { type ExportFormat, exportCapabilities, exportResume, computeEdits } from '@pingx969/resume-export';
import { unfilledPlaceholders } from '@pingx969/resume-optimizer';
import { body, notFound, query, uid } from '../middleware';
import type { AppContext } from '../context';
import { applyDecisions, createOptimizedVersion, sameParse } from '../services/versions';
import { safeFilename } from './resumes';

export function versionRoutes(ctx: AppContext, heavy: ReturnType<typeof import('../middleware').rateLimit>): Router {
  const r = Router();

  r.post('/', heavy, async (req, res) => {
    const input = body(z.object({ resumeId: z.string().uuid(), jobId: z.string().uuid(), provider: z.string().optional(), consentExternal: z.boolean().optional(), scope: z.enum(['full', 'skills']).default('full') }), req);
    const { version, payload } = await createOptimizedVersion(ctx, uid(req), input.resumeId, input.jobId, input);
    res.status(201).json({ version, payload });
  });

  r.get('/', async (req, res) => {
    const f = query(z.object({ resumeId: z.string().uuid().optional(), jobId: z.string().uuid().optional() }), req);
    res.json({ versions: await ctx.repos.listVersions(uid(req), f) });
  });

  r.get('/:id', async (req, res) => {
    const userId = uid(req);
    const version = await ctx.repos.getVersion(userId, String(req.params.id));
    if (!version) throw notFound('Version');
    const resume = await ctx.repos.getResume(userId, version.resumeId);
    const job = version.jobId ? await ctx.repos.getJob(userId, version.jobId) : null;
    const { payload, ...meta } = version;
    res.json({
      version: meta,
      payload,
      original: resume?.parsed.data ?? null,
      resume: resume ? { id: resume.id, name: resume.name, sourceFormat: resume.sourceFormat } : null,
      job: job ? { id: job.id, title: job.title, company: job.company, url: job.url, analysis: job.description?.analysis ?? null } : null,
      capabilities: resume ? exportCapabilities(resume.sourceFormat) : [],
      placeholders: unfilledPlaceholders(payload.changes).length,
      edits: resume ? summarizeEdits(computeEdits(resume.parsed.data, payload.optimized)) : null,
    });
  });

  r.patch('/:id', async (req, res) => {
    const input = body(
      z.object({
        label: z.string().trim().min(1).max(300).optional(),
        decisions: z
          .array(
            z.object({
              id: z.string().max(100),
              accepted: z.boolean().optional(),
              after: z.union([z.string().max(2000), z.array(z.string().max(200)).max(300)]).optional(),
              confirmSkill: z.boolean().optional(),
            }),
          )
          .max(500)
          .default([]),
      }),
      req,
    );
    const out = await applyDecisions(ctx, uid(req), String(req.params.id), input.decisions, input.label);
    res.json(out);
  });

  r.get('/:id/export', async (req, res) => {
    const userId = uid(req);
    const q = query(z.object({ format: z.enum(['pdf', 'docx', 'json', 'txt', 'md']), force: z.string().optional(), inline: z.string().optional() }), req);
    const version = await ctx.repos.getVersion(userId, String(req.params.id));
    if (!version) throw notFound('Version');
    const placeholders = unfilledPlaceholders(version.payload.changes);
    if (placeholders.length && !q.force) {
      throw new AppError(ErrorCodes.CONFLICT, `This version still contains ${placeholders.length} unfilled placeholder(s) like "[add measurable result]". Fill them in or reject those suggestions before exporting.`, 409, { placeholders: placeholders.map((p) => p.id) });
    }
    const resume = await ctx.repos.getResume(userId, version.resumeId);
    if (!resume) throw new AppError(ErrorCodes.NOT_FOUND, 'The original resume for this version was deleted.', 404);
    const doc = resume.sourceDocumentId ? await ctx.repos.getDocument(userId, resume.sourceDocumentId) : null;
    // A version made from an older parse can't be patched into the original file; render it instead.
    const compatible = sameParse(version.payload.metadata, resume.parsed.parserVersion);
    const originalBytes = doc && compatible ? new Uint8Array(await ctx.store.get(doc.storageKey)) : null;
    const out = await exportResume({ format: q.format as ExportFormat, source: resume.parsed, sourceFormat: resume.sourceFormat, originalBytes, optimized: version.payload.optimized, title: version.label });
    const name = safeFilename(`${resume.parsed.data.personal.name || resume.name} ${version.company}`);
    res.setHeader('Content-Type', out.mime);
    res.setHeader('Content-Disposition', `${q.inline ? 'inline' : 'attachment'}; filename="${name}.${out.extension}"`);
    res.setHeader('X-Export-Fidelity', out.fidelity);
    if (out.warnings.length) res.setHeader('X-Export-Warnings', encodeURIComponent(out.warnings.join(' | ')).slice(0, 2000));
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(Buffer.from(out.bytes));
  });

  r.delete('/:id', async (req, res) => {
    if (!(await ctx.repos.deleteVersion(uid(req), String(req.params.id)))) throw notFound('Version');
    res.json({ ok: true });
  });

  return r;
}

function summarizeEdits(e: ReturnType<typeof computeEdits>) {
  return { bullets: e.bulletText.length, skills: e.skills.length, summary: !!(e.summary || e.summaryInsert), reorders: e.reorders.length };
}
