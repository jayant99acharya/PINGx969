import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { type Change, type JobAnalysis, type ParsedResume, DEFAULT_WEIGHTS } from '@pingx969/shared';
import { analyzeJob } from '@pingx969/job-parser';
import { parseResume } from '@pingx969/resume-parser';
import {
  type AIProvider,
  HeuristicProvider,
  applyChanges,
  assessSkill,
  buildFactBase,
  guardChange,
  guardText,
  matchResume,
  redactForAI,
  rewriteBullet,
  runOptimization,
  unfilledPlaceholders,
} from '../src';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures');
let resume: ParsedResume;
let backend: JobAnalysis;
let frontend: JobAnalysis;
const now = new Date('2026-10-02');

beforeAll(async () => {
  resume = await parseResume(new Uint8Array(fs.readFileSync(path.join(root, 'resumes/jane-doe.docx'))), 'jane-doe.docx');
  backend = analyzeJob(fs.readFileSync(path.join(root, 'jobs/backend-senior.txt'), 'utf8'));
  frontend = analyzeJob(fs.readFileSync(path.join(root, 'jobs/frontend.txt'), 'utf8'));
});

describe('matching engine', () => {
  it('scores every dimension with explanations', () => {
    const m = matchResume(resume.data, backend, { document: resume.document, now });
    const d = Object.fromEntries(m.dimensions.map((x) => [x.key, x]));
    expect(d.experience.score).toBe(100); // 8+ years vs 5+
    expect(d.education.score).toBe(100);
    expect(d.seniority.score).toBe(100);
    expect(d.domain.score).toBe(0); // healthcare/e-commerce vs fintech
    expect(d.skills.score).toBeGreaterThan(50);
    expect(d.skills.score).toBeLessThan(90);
    expect(d.ats.score).toBeGreaterThan(80);
    for (const x of m.dimensions) expect(x.summary.length).toBeGreaterThan(5);
    expect(m.methodology).toMatch(/weighted average/);
    // overall is the weighted mean of applicable dimensions
    const app = m.dimensions.filter((x) => x.applicable);
    const expected = app.reduce((n, x) => n + x.score * x.weight, 0) / app.reduce((n, x) => n + x.weight, 0);
    expect(Math.abs(m.overall - expected)).toBeLessThanOrEqual(1);
  });

  it('classifies skills as matched / partial / transferable / missing', () => {
    const facts = buildFactBase(resume.data, { now });
    expect(assessSkill('PostgreSQL', true, facts, backend).status).toBe('matched');
    expect(assessSkill('SQL', true, facts, backend).status).toBe('matched');
    expect(assessSkill('EC2', true, facts, backend)).toMatchObject({ status: 'partial', via: 'AWS' });
    expect(assessSkill('Kubernetes', true, facts, backend)).toMatchObject({ status: 'transferable', via: 'Docker' });
    expect(assessSkill('Terraform', true, facts, backend).status).toBe('missing');
    // "Datadog or Prometheus": neither present
    expect(assessSkill('Datadog', false, facts, backend).status).toBe('missing');
  });

  it('weights are configurable and inapplicable dimensions are excluded', () => {
    const base = matchResume(resume.data, backend, { document: resume.document, now });
    const domainHeavy = matchResume(resume.data, backend, { document: resume.document, now, weights: { domain: 100 } });
    expect(domainHeavy.overall).toBeLessThan(base.overall);
    const onlyExperience = matchResume(resume.data, backend, { document: resume.document, now, weights: Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((k) => [k, k === 'experience' ? 10 : 0])) });
    expect(onlyExperience.overall).toBe(100);
    const noYears = matchResume(resume.data, { ...backend, yearsExperience: { min: null, max: null, text: '' } }, { document: resume.document, now });
    expect(noYears.dimensions.find((x) => x.key === 'experience')!.applicable).toBe(false);
  });

  it('a candidate-confirmed skill counts as matched', () => {
    const m = matchResume(resume.data, backend, { document: resume.document, now, confirmedSkills: ['Terraform'] });
    expect(m.skills.find((s) => s.skill === 'Terraform')!.status).toBe('matched');
  });
});

describe('fact guard (hallucination protection)', () => {
  let facts: ReturnType<typeof buildFactBase>;
  beforeAll(() => {
    facts = buildFactBase(resume.data, { now });
  });

  it('allows truthful rephrasing', () => {
    expect(guardText('Built backend services for internal applications.', 'Built Python backend services for internal applications.', facts).ok).toBe(true);
    expect(guardText('Responsible for maintaining Postgres database schemas.', 'Maintained PostgreSQL database schemas.', facts).ok).toBe(true);
  });

  it.each([
    ['new technology', 'Built backend services for internal applications.', 'Built Kubernetes-based backend services for internal applications.', /Kubernetes/],
    ['new metric', 'Built backend services for internal applications.', 'Built backend services for internal applications, improving latency by 45%.', /45%/],
    ['new employer', 'Built backend services for internal applications.', 'Built backend services for internal applications at Stripe.', /Stripe/],
    ['inflated years', 'Software engineer.', 'Software engineer with 15 years of experience.', /15 years/],
    ['invented degree', 'Built backend services.', 'Built backend services while completing a PhD.', /degree/],
  ])('blocks %s', (_name, before, after, reason) => {
    const r = guardText(before, after, facts);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(reason);
  });

  it('blocks invalid reorders and unsupported skill additions', () => {
    const base = { id: 'x', section: 'skills' as const, provenance: 'fact' as const, evidence: [], reason: 'r', accepted: true, informational: false, blocked: null, hasPlaceholder: false, edited: false, source: 'test' };
    expect(guardChange({ ...base, kind: 'skills_reordered', target: {}, before: ['Python', 'Go'], after: ['Go', 'Python', 'Rust'] }, facts).blocked).toMatch(/Blocked/);
    expect(guardChange({ ...base, kind: 'skill_added', target: {}, before: null, after: 'Terraform' }, facts).blocked).toMatch(/not supported/);
    expect(guardChange({ ...base, kind: 'skill_added', target: {}, before: null, after: 'SQL' }, facts).blocked).toBeNull();
    // User-edited text is the user's own claim
    expect(guardChange({ ...base, kind: 'bullet_rephrased', target: {}, before: 'a', after: 'Led 40 engineers at Google', edited: true }, facts).blocked).toBeNull();
  });
});

describe('heuristic optimizer', () => {
  for (const which of ['backend', 'frontend'] as const) {
    it(`never fabricates for the ${which} job (every change passes the guard)`, async () => {
      const job = which === 'backend' ? backend : frontend;
      const match = matchResume(resume.data, job, { document: resume.document, now });
      const out = await runOptimization(new HeuristicProvider(), { resume: resume.data, job, match, confirmedSkills: [] });
      expect(out.changes.filter((c) => c.blocked)).toEqual([]);
      const optimized = applyChanges(resume.data, out.changes);
      const text = JSON.stringify(optimized);
      for (const s of match.skills.filter((x) => x.status === 'missing')) {
        expect(text.includes(`"${s.skill}"`), `${s.skill} was added`).toBe(false);
      }
      // titles, companies, dates unchanged; same number of bullets
      expect(optimized.experience.map((e) => [e.title, e.company, e.startDate, e.endDate, e.bullets.length])).toEqual(resume.data.experience.map((e) => [e.title, e.company, e.startDate, e.endDate, e.bullets.length]));
      expect(unfilledPlaceholders(out.changes)).toHaveLength(0);
    });
  }

  it('prioritizes, rephrases and reports what it did', async () => {
    const match = matchResume(resume.data, backend, { document: resume.document, now });
    const { changes } = await runOptimization(new HeuristicProvider(), { resume: resume.data, job: backend, match, confirmedSkills: [] });
    const kinds = new Set(changes.map((c) => c.kind));
    for (const k of ['summary_rephrased', 'skills_reordered', 'skill_added', 'skill_not_added', 'bullet_rephrased', 'bullets_reordered', 'suggestion']) expect(kinds.has(k as Change['kind']), k).toBe(true);
    const sum = changes.find((c) => c.kind === 'summary_rephrased')!;
    expect(sum.after).toMatch(/^Senior Software Engineer with 8\+ years of experience/);
    expect(sum.evidence.length).toBeGreaterThan(2);
    const inference = changes.find((c) => c.provenance === 'inference' && c.kind === 'bullet_rephrased')!;
    expect(inference.after).toBe('Built Python backend services for internal applications.');
    expect(inference.evidence[0]).toMatch(/Same role/);
    const sug = changes.find((c) => c.kind === 'suggestion')!;
    expect(sug).toMatchObject({ accepted: false, hasPlaceholder: true });
    expect(sug.after).toMatch(/\[add measurable result/);
  });

  it('keeps parallel grammar when replacing weak openers', () => {
    const facts = buildFactBase(resume.data, { now });
    const rw = rewriteBullet({ id: 'b', text: 'Responsible for maintaining Postgres database schemas and writing SQL reports.', line: null }, [], [], backend, facts);
    expect(rw?.text).toBe('Maintained PostgreSQL database schemas and wrote SQL reports.');
    expect(rewriteBullet({ id: 'b', text: 'Collaborated with product managers.', line: null }, [], [], backend, facts)).toBeNull();
  });

  it('applyChanges honours rejections and never mutates the original', async () => {
    const match = matchResume(resume.data, backend, { document: resume.document, now });
    const { changes } = await runOptimization(new HeuristicProvider(), { resume: resume.data, job: backend, match, confirmedSkills: [] });
    const snapshot = JSON.stringify(resume.data);
    const rejected = changes.map((c) => ({ ...c, accepted: false }));
    expect(applyChanges(resume.data, rejected)).toEqual(resume.data);
    expect(JSON.stringify(resume.data)).toBe(snapshot);
  });
});

describe('AI provider layer', () => {
  const failing = (err: Error): AIProvider => ({
    name: 'fake',
    external: true,
    model: 'fake-model',
    analyzeJobDescription: async () => {
      throw err;
    },
    analyzeResume: async () => {
      throw err;
    },
    optimizeResume: async () => {
      throw err;
    },
    normalizeQuestion: async () => {
      throw err;
    },
  });

  it('falls back to the local optimizer on provider failure', async () => {
    const match = matchResume(resume.data, backend, { now });
    const out = await runOptimization(failing(new Error('boom')), { resume: resume.data, job: backend, match, confirmedSkills: [] });
    expect(out.fellBack).toBe(true);
    expect(out.provider).toBe('heuristic');
    expect(out.warnings[0]).toMatch(/AI provider failed/);
    expect(out.changes.length).toBeGreaterThan(5);
  });

  it('times out slow providers', async () => {
    const slow: AIProvider = { ...failing(new Error('x')), optimizeResume: () => new Promise((r) => setTimeout(() => r({ changes: [], warnings: [] }), 5000)) };
    const match = matchResume(resume.data, backend, { now });
    const out = await runOptimization(slow, { resume: resume.data, job: backend, match, confirmedSkills: [] }, { timeoutMs: 50 });
    expect(out.fellBack).toBe(true);
    expect(out.warnings[0]).toMatch(/timed out/);
  });

  it('validates AI output: malformed changes are discarded, fabrications blocked', async () => {
    const bulletId = resume.data.experience[0].bullets[0].id;
    const fabricating: AIProvider = {
      ...failing(new Error('x')),
      optimizeResume: async () => ({
        warnings: [],
        changes: [
          { nonsense: true } as unknown as Change,
          {
            id: 'ai-1',
            kind: 'bullet_rephrased',
            section: 'experience',
            target: { experienceId: resume.data.experience[0].id, bulletId },
            before: resume.data.experience[0].bullets[0].text,
            after: 'Built Kubernetes microservices for 50M users at Netflix.',
            provenance: 'fact',
            evidence: [],
            reason: 'stronger',
            accepted: true,
            informational: false,
            blocked: null,
            hasPlaceholder: false,
            edited: false,
            source: 'fake',
          },
        ],
      }),
    };
    const match = matchResume(resume.data, backend, { now });
    const out = await runOptimization(fabricating, { resume: resume.data, job: backend, match, confirmedSkills: [] });
    expect(out.warnings.join(' ')).toMatch(/invalid structure/);
    const c = out.changes.find((x) => x.id === 'ai-1')!;
    expect(c.accepted).toBe(false);
    expect(c.blocked).toMatch(/Kubernetes/);
    expect(c.blocked).toMatch(/50m/i);
    expect(c.blocked).toMatch(/Netflix/);
    expect(JSON.stringify(applyChanges(resume.data, out.changes))).not.toContain('Netflix');
  });

  it('redacts contact details before anything is sent to an external provider', () => {
    const payload = JSON.stringify(redactForAI(resume.data));
    expect(payload).not.toContain('jane.doe@example.com');
    expect(payload).not.toContain('555-0142');
    expect(payload).not.toContain('Jane Doe');
    expect(payload).not.toContain('linkedin.com');
    expect(payload).toContain('Northwind Commerce');
  });
});
