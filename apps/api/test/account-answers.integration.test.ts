/**
 * Saved answers, field mappings, settings validation, autofill bootstrap, data export, account deletion
 * and transparent re-parsing of resumes stored by an older parser — including cross-user isolation.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { PARSER_VERSION } from '@pingx969/resume-parser';
import type { AppContext } from '../src/context';
import { fixture, makeApp, register, type Session } from './helpers';

let app: Express;
let ctx: AppContext;
let a: Session;
let b: Session;
const post = (s: Session, url: string) => s.agent.post(url).set('X-CSRF-Token', s.csrf);

beforeAll(async () => {
  ({ app, ctx } = await makeApp());
  a = await register(app, 'answers-a@example.com');
  b = await register(app, 'answers-b@example.com');
});

describe('saved answers', () => {
  let id: string;

  it('normalizes equivalent wordings into one saved answer', async () => {
    const first = await post(a, '/api/answers').send({ question: 'Are you legally authorized to work in the United States?', answer: 'Yes' }).expect(201);
    id = first.body.answer.id;
    expect(first.body.mapping.key).toBe('work_authorization:US');
    const second = await post(a, '/api/answers').send({ question: 'Do you currently have authorization to work in the US?', answer: 'Yes ' }).expect(201);
    expect(second.body.answer.questionKey).toBe('work_authorization:US');
    const list = await a.agent.get('/api/answers').expect(200);
    expect(list.body.answers).toHaveLength(1);
    expect(list.body.answers[0].answer).toBe('Yes');
  });

  it('merges a near-identical custom question into the existing entry', async () => {
    await post(a, '/api/answers').send({ question: 'Why do you want to join Initech?', answer: 'Mission' }).expect(201);
    await post(a, '/api/answers').send({ question: 'Why do you want to join Initech ?', answer: 'Mission and team' }).expect(201);
    const list = await a.agent.get('/api/answers?q=initech').expect(200);
    expect(list.body.answers).toHaveLength(1);
    expect(list.body.answers[0].answer).toBe('Mission and team');
  });

  it('looks up answers from saved answers, then the profile, and never invents one', async () => {
    await a.agent.patch('/api/profile').set('X-CSRF-Token', a.csrf).send({ workAuthorization: { requiresSponsorship: 'no' } }).expect(200);
    const res = await post(a, '/api/answers/lookup')
      .send({ questions: ['Are you authorized to work in the U.S.?', 'Will you require visa sponsorship?', 'What is your favourite colour?'] })
      .expect(200);
    const [saved, profile, unknown] = res.body.results;
    expect(saved).toMatchObject({ answer: 'Yes', source: 'saved' });
    expect(profile).toMatchObject({ answer: 'No', source: 'profile' });
    expect(unknown).toMatchObject({ answer: null, source: null });
  });

  it('updates, marks used and deletes — and other users cannot touch it', async () => {
    await b.agent.patch(`/api/answers/${id}`).set('X-CSRF-Token', b.csrf).send({ answer: 'No' }).expect(404);
    await b.agent.delete(`/api/answers/${id}`).set('X-CSRF-Token', b.csrf).expect(404);
    expect((await b.agent.get('/api/answers').expect(200)).body.answers).toHaveLength(0);
    const upd = await a.agent.patch(`/api/answers/${id}`).set('X-CSRF-Token', a.csrf).send({ answer: ' Yes, citizen ' }).expect(200);
    expect(upd.body.answer.answer).toBe('Yes, citizen');
    await post(a, '/api/answers/used').send({ keys: ['work_authorization:US'] }).expect(200);
    await a.agent.delete(`/api/answers/${id}`).set('X-CSRF-Token', a.csrf).expect(200);
    await a.agent.delete(`/api/answers/${id}`).set('X-CSRF-Token', a.csrf).expect(404);
  });

  it('validates input and requires the CSRF token', async () => {
    await post(a, '/api/answers').send({ question: 'x', answer: 'y' }).expect(400);
    await a.agent.post('/api/answers').send({ question: 'Valid question?', answer: 'y' }).expect(403);
  });
});

describe('field mappings', () => {
  it('stores a user correction and requires a key for question mappings', async () => {
    await post(a, '/api/field-mappings').send({ host: 'jobs.example.com', signature: 'text:q_1:what', fieldType: 'question' }).expect(400);
    const created = await post(a, '/api/field-mappings').send({ host: 'jobs.example.com', signature: 'text:fname:given name', fieldType: 'firstName' }).expect(201);
    expect((await a.agent.get('/api/field-mappings').expect(200)).body.mappings).toHaveLength(1);
    await b.agent.delete(`/api/field-mappings/${created.body.mapping.id}`).set('X-CSRF-Token', b.csrf).expect(404);
    await a.agent.delete(`/api/field-mappings/${created.body.mapping.id}`).set('X-CSRF-Token', a.csrf).expect(200);
  });
});

describe('settings and the extension bootstrap', () => {
  it('rejects all-zero weights and unconfigured AI providers', async () => {
    const zero = Object.fromEntries(['skills', 'experience', 'responsibilities', 'keywords', 'education', 'seniority', 'technology', 'domain', 'ats'].map((k) => [k, 0]));
    await a.agent.put('/api/settings').set('X-CSRF-Token', a.csrf).send({ scoringWeights: zero }).expect(400);
    await a.agent.put('/api/settings').set('X-CSRF-Token', a.csrf).send({ aiProvider: 'anthropic' }).expect(400);
    const ok = await a.agent.put('/api/settings').set('X-CSRF-Token', a.csrf).send({ scoringWeights: { skills: 40 }, showLauncher: false }).expect(200);
    expect(ok.body.settings.scoringWeights.skills).toBe(40);
    expect(ok.body.settings.scoringWeights.experience).toBeGreaterThan(0); // defaults kept for the rest
  });

  it('gives the extension profile, answers, mappings and settings in one call', async () => {
    const boot = await a.agent.get('/api/autofill/bootstrap').expect(200);
    expect(boot.headers['cache-control']).toContain('no-store');
    expect(boot.body.user.email).toBe('answers-a@example.com');
    expect(boot.body.settings).toEqual({ autoLearn: expect.any(Boolean), showLauncher: false });
    expect(Array.isArray(boot.body.answers)).toBe(true);
    const page = await post(a, '/api/autofill/page').send({ url: 'https://jobs.example.com/apply/1', company: 'Initech', title: 'Engineer' }).expect(200);
    expect(page.body).toMatchObject({ job: null, recommendedVersion: null, application: null });
  });
});

describe('resumes stored by an older parser', () => {
  it('are re-parsed from the original file when opened', async () => {
    const up = await post(a, '/api/resumes').attach('file', fixture('resumes/jane-doe.docx'), 'jane-doe.docx').expect(201);
    const id = up.body.resume.id;
    const stored = (await ctx.repos.getResume(a.userId, id))!;
    // simulate a parse made by parser version 1 that missed the skills
    await ctx.repos.updateResumeParsed(a.userId, id, { ...stored.parsed, parserVersion: 1, data: { ...stored.parsed.data, skills: [] } });
    const res = await a.agent.get(`/api/resumes/${id}`).expect(200);
    expect(res.body.data.skills.length).toBeGreaterThan(0);
    expect((await ctx.repos.getResume(a.userId, id))!.parsed.parserVersion).toBe(PARSER_VERSION);
  });
});

describe('account data controls', () => {
  it('exports everything stored for the user as JSON', async () => {
    const res = await a.agent.get('/api/account/export').expect(200);
    expect(res.headers['content-disposition']).toContain('pingx969-export.json');
    expect(res.body.user.email).toBe('answers-a@example.com');
    expect(res.body.resumes.length).toBeGreaterThan(0);
    expect(res.body.savedAnswers.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('deletes the account only with the right password, removing data and files', async () => {
    const keys = await ctx.repos.listDocumentKeys(a.userId);
    expect(keys.length).toBeGreaterThan(0);
    await a.agent.delete('/api/account').set('X-CSRF-Token', a.csrf).send({ password: 'wrong-password' }).expect(401);
    await a.agent.delete('/api/account').set('X-CSRF-Token', a.csrf).send({ password: 'correct-horse-battery' }).expect(200);
    await a.agent.get('/api/resumes').expect(401);
    expect(await ctx.repos.getUser(a.userId)).toBeFalsy();
    for (const k of keys) await expect(ctx.store.get(k)).rejects.toThrow();
    // the other user is untouched
    await b.agent.get('/api/answers').expect(200);
  });
});
