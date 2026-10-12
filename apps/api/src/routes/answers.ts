import { Router } from 'express';
import { z } from 'zod';
import { AppError, ErrorCodes, FieldTypes } from '@pingx969/shared';
import { cleanQuestion, findSavedAnswer, normalizeQuestion, profileAnswerFor } from '@pingx969/profile';
import { body, notFound, query, uid } from '../middleware';
import type { AppContext } from '../context';

export function answerRoutes(ctx: AppContext): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const { q } = query(z.object({ q: z.string().max(200).optional() }), req);
    let answers = await ctx.repos.listAnswers(uid(req));
    if (q) {
      const needle = q.toLowerCase();
      answers = answers.filter((a) => a.rawQuestion.toLowerCase().includes(needle) || a.normalizedQuestion.toLowerCase().includes(needle) || a.answer.toLowerCase().includes(needle));
    }
    res.json({ answers });
  });

  /** Save (or update) an answer. The question is normalized so equivalent wordings share one entry. */
  r.post('/', async (req, res) => {
    const input = body(
      z.object({
        question: z.string().trim().min(2).max(1000),
        answer: z.string().max(10000),
        source: z.enum(['user', 'learned', 'imported']).default('user'),
        questionKey: z.string().max(200).optional(),
      }),
      req,
    );
    const userId = uid(req);
    const mapping = normalizeQuestion(input.question);
    let key = input.questionKey && /^[\w:.-]+$/.test(input.questionKey) ? input.questionKey : mapping.key;
    // A custom question that closely matches an existing saved one updates that entry.
    if (key.startsWith('custom:')) {
      const existing = findSavedAnswer(input.question, await ctx.repos.listAnswers(userId), 0.85);
      if (existing) key = existing.answer.questionKey;
    }
    const saved = await ctx.repos.upsertAnswer(userId, {
      questionKey: key,
      rawQuestion: cleanQuestion(input.question),
      normalizedQuestion: mapping.normalized,
      answer: input.answer.trim(),
      source: input.source,
      confidence: input.source === 'user' ? 1 : mapping.confidence,
      sensitive: mapping.sensitive,
    });
    res.status(201).json({ answer: saved, mapping });
  });

  /** Resolve answers for a batch of questions (used by the extension and the dashboard). */
  r.post('/lookup', async (req, res) => {
    const { questions } = body(z.object({ questions: z.array(z.string().max(1000)).max(200) }), req);
    const userId = uid(req);
    const [answers, { profile }] = await Promise.all([ctx.repos.listAnswers(userId), ctx.repos.getProfile(userId)]);
    const results = questions.map((q) => {
      const mapping = normalizeQuestion(q);
      const hit = findSavedAnswer(q, answers);
      if (hit) return { question: q, mapping, answer: hit.answer.answer, confidence: hit.confidence, source: 'saved', answerId: (hit.answer as { id?: string }).id ?? null };
      const fromProfile = profileAnswerFor(mapping.key, profile);
      if (fromProfile) return { question: q, mapping, answer: fromProfile, confidence: 0.9, source: 'profile', answerId: null };
      return { question: q, mapping, answer: null, confidence: 0, source: null, answerId: null };
    });
    res.json({ results });
  });

  r.patch('/:id', async (req, res) => {
    const { answer } = body(z.object({ answer: z.string().max(10000) }), req);
    const updated = await ctx.repos.updateAnswer(uid(req), String(req.params.id), answer.trim());
    if (!updated) throw notFound('Saved answer');
    res.json({ answer: updated });
  });

  r.delete('/:id', async (req, res) => {
    if (!(await ctx.repos.deleteAnswer(uid(req), String(req.params.id)))) throw notFound('Saved answer');
    res.json({ ok: true });
  });

  r.post('/used', async (req, res) => {
    const { keys } = body(z.object({ keys: z.array(z.string().max(200)).max(200) }), req);
    await ctx.repos.markAnswersUsed(uid(req), keys);
    res.json({ ok: true });
  });

  return r;
}

export function mappingRoutes(ctx: AppContext): Router {
  const r = Router();
  r.get('/', async (req, res) => {
    res.json({ mappings: await ctx.repos.listMappings(uid(req)) });
  });
  r.post('/', async (req, res) => {
    const input = body(
      z.object({
        host: z.string().trim().min(1).max(255),
        signature: z.string().trim().min(1).max(500),
        label: z.string().max(500).default(''),
        fieldType: z.enum(FieldTypes),
        questionKey: z.string().max(200).nullable().default(null),
      }),
      req,
    );
    if (input.fieldType === 'question' && !input.questionKey) throw new AppError(ErrorCodes.VALIDATION, 'A question mapping needs a question key.', 400);
    res.status(201).json({ mapping: await ctx.repos.upsertMapping(uid(req), input) });
  });
  r.delete('/:id', async (req, res) => {
    if (!(await ctx.repos.deleteMapping(uid(req), String(req.params.id)))) throw notFound('Mapping');
    res.json({ ok: true });
  });
  return r;
}
