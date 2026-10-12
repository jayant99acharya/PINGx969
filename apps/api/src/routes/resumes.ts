import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { AppError, ErrorCodes, mergeProfile } from '@pingx969/shared';
import { sha256 } from '@pingx969/database';
import { detectFormat, parseResume } from '@pingx969/resume-parser';
import { type ExportFormat, EXPORT_MIME, exportCapabilities, exportResume } from '@pingx969/resume-export';
import { profileFromResume } from '@pingx969/profile';
import { body, notFound, uid, upload } from '../middleware';
import type { AppContext } from '../context';
import { computeMatch, factSummary } from '../services/versions';
import { loadResume } from '../services/resumes';

export const MIME_FOR: Record<string, string> = {
  pdf: 'application/pdf',
  docx: EXPORT_MIME.docx,
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
};

export function safeFilename(s: string): string {
  return s.replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').slice(0, 80) || 'resume';
}

export function resumeRoutes(ctx: AppContext, heavy: ReturnType<typeof import('../middleware').rateLimit>): Router {
  const r = Router();

  r.post('/', heavy, upload.single('file'), async (req, res) => {
    const file = req.file;
    if (!file) throw new AppError(ErrorCodes.VALIDATION, 'Choose a resume file to upload.', 400);
    const bytes = new Uint8Array(file.buffer);
    const format = detectFormat(bytes, file.originalname); // magic-byte validation
    const parsed = await parseResume(bytes, file.originalname);
    const userId = uid(req);
    const key = `${userId}/resumes/${crypto.randomUUID()}`;
    await ctx.store.put(key, bytes);
    let documentId: string;
    try {
      documentId = await ctx.repos.createDocument(userId, { kind: 'resume_source', filename: file.originalname, mimeType: MIME_FOR[format], size: bytes.length, sha256: sha256(bytes), storageKey: key });
    } catch (e) {
      await ctx.store.delete(key);
      throw e;
    }
    const name = String(req.body?.name || file.originalname.replace(/\.[^.]+$/, '')).slice(0, 200);
    const resume = await ctx.repos.createResume(userId, name, format, documentId, parsed);
    // First resume: offer the profile import automatically for empty fields only.
    let profileUpdated = false;
    if (String(req.body?.importToProfile ?? 'true') === 'true') {
      const { profile } = await ctx.repos.getProfile(userId);
      const next = profileFromResume(profile, parsed.data);
      if (JSON.stringify(next) !== JSON.stringify(profile)) {
        await ctx.repos.saveProfile(userId, next);
        profileUpdated = true;
      }
    }
    res.status(201).json({ resume, data: parsed.data, warnings: parsed.document.warnings, profileUpdated, facts: factSummary(parsed, []) });
  });

  r.get('/', async (req, res) => {
    res.json({ resumes: await ctx.repos.listResumes(uid(req)) });
  });

  r.get('/:id', async (req, res) => {
    const userId = uid(req);
    const resume = await loadResume(ctx, userId, String(req.params.id));
    if (!resume) throw notFound('Resume');
    const { profile } = await ctx.repos.getProfile(userId);
    const { parsed, ...meta } = resume;
    res.json({
      resume: meta,
      data: parsed.data,
      layout: parsed.document.layout,
      structure: parsed.document.structure,
      warnings: parsed.document.warnings,
      facts: factSummary(parsed, profile.confirmedSkills),
      capabilities: exportCapabilities(resume.sourceFormat),
    });
  });

  r.get('/:id/original', async (req, res) => {
    const userId = uid(req);
    const resume = await loadResume(ctx, userId, String(req.params.id));
    if (!resume?.sourceDocumentId) throw notFound('Original file');
    const doc = await ctx.repos.getDocument(userId, resume.sourceDocumentId);
    if (!doc) throw notFound('Original file');
    const bytes = await ctx.store.get(doc.storageKey);
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${safeFilename(doc.filename)}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(bytes);
  });

  /** Export the original (unoptimized) resume in another format. */
  r.get('/:id/export', async (req, res) => {
    const userId = uid(req);
    const format = z.enum(['pdf', 'docx', 'json', 'txt', 'md']).parse(req.query.format) as ExportFormat;
    const resume = await loadResume(ctx, userId, String(req.params.id));
    if (!resume) throw notFound('Resume');
    const doc = resume.sourceDocumentId ? await ctx.repos.getDocument(userId, resume.sourceDocumentId) : null;
    const originalBytes = doc ? new Uint8Array(await ctx.store.get(doc.storageKey)) : null;
    const out = await exportResume({ format, source: resume.parsed, sourceFormat: resume.sourceFormat, originalBytes, optimized: resume.parsed.data, title: resume.name });
    res.setHeader('Content-Type', out.mime);
    res.setHeader('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename="${safeFilename(resume.name)}.${out.extension}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(Buffer.from(out.bytes));
  });

  r.patch('/:id', async (req, res) => {
    const input = body(z.object({ name: z.string().trim().min(1).max(200).optional(), isDefault: z.boolean().optional() }), req);
    if (!(await ctx.repos.updateResume(uid(req), String(req.params.id), input))) throw notFound('Resume');
    res.json({ ok: true });
  });

  r.delete('/:id', async (req, res) => {
    const key = await ctx.repos.deleteResume(uid(req), String(req.params.id));
    if (key === null) throw notFound('Resume');
    if (key) await ctx.store.delete(key);
    res.json({ ok: true });
  });

  r.post('/:id/import-to-profile', async (req, res) => {
    const userId = uid(req);
    const resume = await loadResume(ctx, userId, String(req.params.id));
    if (!resume) throw notFound('Resume');
    const { profile } = await ctx.repos.getProfile(userId);
    const next = mergeProfile(profileFromResume(profile, resume.parsed.data), {});
    await ctx.repos.saveProfile(userId, next);
    res.json({ profile: next });
  });

  r.post('/:id/match', async (req, res) => {
    const userId = uid(req);
    const { jobId } = body(z.object({ jobId: z.string().uuid() }), req);
    const resume = await loadResume(ctx, userId, String(req.params.id));
    if (!resume) throw notFound('Resume');
    const job = await ctx.repos.getJob(userId, jobId);
    if (!job?.description) throw notFound('Job');
    res.json({ match: await computeMatch(ctx, userId, resume.parsed, job.description.analysis) });
  });

  return r;
}
