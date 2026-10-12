import { Router } from 'express';
import { z } from 'zod';
import { AppError, ErrorCodes } from '@pingx969/shared';
import { extractJobPostingFromHtml, htmlToText } from '@pingx969/job-parser';
import { parseResume } from '@pingx969/resume-parser';
import { analyzeJobWithProvider } from '@pingx969/resume-optimizer';
import { notFound, uid, upload } from '../middleware';
import type { AppContext } from '../context';
import { safeFetchText } from '../services/url-fetch';

const CreateJob = z.object({
  text: z.string().max(60_000).optional().default(''),
  url: z.string().trim().max(2048).optional().default(''),
  title: z.string().trim().max(300).optional().default(''),
  company: z.string().trim().max(300).optional().default(''),
  fetchUrl: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
  provider: z.string().optional(),
  source: z.enum(['manual', 'url', 'upload', 'extension']).optional(),
});

export function jobRoutes(ctx: AppContext, heavy: ReturnType<typeof import('../middleware').rateLimit>): Router {
  const r = Router();

  r.post('/', heavy, upload.single('file'), async (req, res) => {
    const userId = uid(req);
    const input = CreateJob.parse(req.body ?? {});
    let text = input.text;
    let title = input.title;
    let company = input.company;
    let source: 'manual' | 'url' | 'upload' | 'extension' = input.source ?? 'manual';
    const warnings: string[] = [];
    if (req.file) {
      if (/\.json$/i.test(req.file.originalname)) throw new AppError(ErrorCodes.UNSUPPORTED_FILE, 'Upload the job description as PDF, DOCX, TXT or Markdown.', 415);
      const parsed = await parseResume(new Uint8Array(req.file.buffer), req.file.originalname).catch((e) => {
        if (e instanceof AppError && e.code === ErrorCodes.EMPTY_RESUME) throw new AppError(ErrorCodes.EMPTY_JOB, 'The uploaded job description file has no readable text.', 422);
        throw e;
      });
      text = parsed.rawText;
      source = 'upload';
    }
    const wantsFetch = input.fetchUrl === true || input.fetchUrl === 'true' || (!text.trim() && !!input.url);
    if (wantsFetch && input.url) {
      try {
        const page = await safeFetchText(input.url, { allowPrivate: ctx.config.allowPrivateUrlFetch });
        const posting = /html/i.test(page.contentType) ? extractJobPostingFromHtml(page.body) : { title: '', company: '', location: '', text: htmlToText(page.body) };
        if (!text.trim()) text = posting.text;
        title ||= posting.title;
        company ||= posting.company;
        source = text === posting.text ? 'url' : source;
      } catch (e) {
        if (!text.trim()) throw e;
        warnings.push(e instanceof AppError ? `${e.message} The pasted description was used instead.` : 'The job URL could not be fetched; the pasted description was used.');
      }
    }
    if (!text.trim()) throw new AppError(ErrorCodes.EMPTY_JOB, 'Paste a job description, upload a file, or provide a job URL.', 422);
    const provider = ctx.provider(input.provider);
    const { analysis, warnings: w } = await analyzeJobWithProvider(provider, { text, url: input.url, title, company });
    warnings.push(...w, ...analysis.warnings);
    const { job, descriptionId } = await ctx.repos.createJob(
      userId,
      { title: title || analysis.title, company: company || analysis.company, url: input.url, location: analysis.location, seniority: analysis.seniority, workArrangement: analysis.workArrangement, source },
      { rawText: text, source, analysis, provider: provider.name },
    );
    res.status(201).json({ job, descriptionId, analysis, warnings });
  });

  r.get('/', async (req, res) => {
    res.json({ jobs: await ctx.repos.listJobs(uid(req)) });
  });

  r.get('/:id', async (req, res) => {
    const job = await ctx.repos.getJob(uid(req), String(req.params.id));
    if (!job) throw notFound('Job');
    res.json({ job });
  });

  r.delete('/:id', async (req, res) => {
    if (!(await ctx.repos.deleteJob(uid(req), String(req.params.id)))) throw notFound('Job');
    res.json({ ok: true });
  });

  return r;
}
