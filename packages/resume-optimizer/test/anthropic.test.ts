/**
 * The Claude provider with a fake SDK client (no network, no API key): request shape, what is (not) sent,
 * merging with the deterministic engine, error mapping, and the fact guard on AI output.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { beforeAll, describe, expect, it } from 'vitest';
import { type JobAnalysis, type ParsedResume, AppError } from '@pingx969/shared';
import { analyzeJob } from '@pingx969/job-parser';
import { parseResume } from '@pingx969/resume-parser';
import { AnthropicProvider, createProvider, matchResume, redactForAI, runOptimization } from '../src';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures');
let resume: ParsedResume;
let job: JobAnalysis;

beforeAll(async () => {
  resume = await parseResume(new Uint8Array(fs.readFileSync(path.join(root, 'resumes/jane-doe.docx'))), 'jane-doe.docx');
  job = analyzeJob(fs.readFileSync(path.join(root, 'jobs/backend-senior.txt'), 'utf8'));
});

type Reply = { stop_reason?: string; parsed_output?: unknown } | Error;
/** Fake `client.beta.messages.parse`: replies in order and records every request. */
function fakeClient(...replies: Reply[]) {
  const requests: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        parse: async (req: Record<string, unknown>) => {
          requests.push(req);
          const r = replies.shift();
          if (!r) throw new Error('unexpected call');
          if (r instanceof Error) throw r;
          return { stop_reason: 'end_turn', ...r };
        },
      },
    },
  } as unknown as Pick<Anthropic, 'beta'>;
  return { client, requests };
}
const sdkError = (cls: abstract new (...args: never[]) => Error) => Object.assign(Object.create(cls.prototype) as Error, { message: 'x', status: 500 });
const input = (scope: 'full' | 'skills' = 'full') => ({ resume: resume.data, job, match: matchResume(resume.data, job, { document: resume.document }), confirmedSkills: [], scope });

describe('AnthropicProvider', () => {
  it('requires an API key when selected', () => {
    expect(() => createProvider({ provider: 'anthropic', anthropic: {} })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('sends structured-output requests with redacted resume data only', async () => {
    const firstBullet = resume.data.experience[0].bullets[0];
    const { client, requests } = fakeClient({
      parsed_output: { summary: { text: '', evidence: [] }, bullets: [{ bulletId: firstBullet.id, text: firstBullet.text, provenance: 'fact', evidence: [], reason: '' }] },
    });
    const p = new AnthropicProvider({ client, model: 'claude-opus-5' });
    await p.optimizeResume(input());
    expect(requests).toHaveLength(1);
    const req = requests[0] as { model: string; output_config: { format: unknown }; messages: { content: string }[] };
    expect(req.model).toBe('claude-opus-5');
    expect(req.output_config.format).toBeTruthy();
    const sent = req.messages[0].content;
    expect(sent).not.toContain(resume.data.personal.email);
    expect(sent).not.toContain(resume.data.personal.phone);
    expect(sent).not.toContain(resume.data.personal.name);
    expect(JSON.stringify(redactForAI(resume.data))).not.toContain(resume.data.personal.email);
  });

  it('sends nothing for a skills-only optimization', async () => {
    const { client, requests } = fakeClient();
    const out = await new AnthropicProvider({ client }).optimizeResume(input('skills'));
    expect(requests).toHaveLength(0);
    expect(out.changes.every((c) => c.section === 'skills')).toBe(true);
  });

  it('merges AI bullet rewrites and summary with the deterministic changes', async () => {
    const b = resume.data.experience[0].bullets[0];
    const { client } = fakeClient({
      parsed_output: {
        summary: { text: 'Senior software engineer with Python and AWS experience.', evidence: [b.text] },
        bullets: [{ bulletId: b.id, text: `${b.text.replace(/\.$/, '')} for checkout services.`, provenance: 'inference', evidence: [b.text], reason: 'Job terminology' }],
      },
    });
    const out = await new AnthropicProvider({ client }).optimizeResume(input());
    const ai = out.changes.filter((c) => c.source === 'anthropic');
    expect(ai).toHaveLength(2);
    expect(ai.map((c) => c.kind)).toEqual(expect.arrayContaining(['bullet_rephrased', expect.stringMatching(/^summary_/)]));
    expect(out.changes.filter((c) => c.kind === 'bullet_rephrased' && c.target.bulletId === b.id)).toHaveLength(1);
  });

  it('blocks AI output that adds facts not in the resume (fact guard)', async () => {
    const b = resume.data.experience[0].bullets[0];
    const { client } = fakeClient({
      parsed_output: {
        summary: { text: '', evidence: [] },
        bullets: [{ bulletId: b.id, text: 'Led a team of 40 engineers migrating 300 services to Rust and Haskell, saving $12M.', provenance: 'fact', evidence: [], reason: '' }],
      },
    });
    const out = await runOptimization(new AnthropicProvider({ client }), input());
    const change = out.changes.find((c) => c.source === 'anthropic' && c.target.bulletId === b.id);
    expect(change?.blocked).toBeTruthy();
    expect(change?.accepted).toBe(false);
  });

  it('merges extracted job requirements with the local parser, canonicalizing skills', async () => {
    const { client } = fakeClient({
      parsed_output: {
        title: 'Backend Engineer', company: 'Globex', seniority: 'senior', requiredSkills: ['golang', 'k8s'], preferredSkills: ['Postgres'], responsibilities: [], qualifications: [],
        yearsMin: 5, yearsMax: null, educationLevel: 'bachelor', educationRequired: true, equivalentExperienceOk: true, location: '', workArrangement: 'remote', employmentType: '', salary: '', otherRequirements: [],
      },
    });
    const a = await new AnthropicProvider({ client }).analyzeJobDescription({ text: fs.readFileSync(path.join(root, 'jobs/backend-senior.txt'), 'utf8'), url: '', title: '', company: '' });
    expect(a.requiredSkills).toEqual(expect.arrayContaining(['Go', 'Kubernetes', 'Python']));
    expect(new Set(a.requiredSkills).size).toBe(a.requiredSkills.length);
  });

  it.each([
    [{ stop_reason: 'refusal' }, /declined/],
    [{ stop_reason: 'max_tokens' }, /cut off/],
    [{ parsed_output: null }, /malformed/],
    [sdkError(Anthropic.AuthenticationError), /API key/],
    [sdkError(Anthropic.RateLimitError), /rate limiting/],
    [sdkError(Anthropic.APIConnectionTimeoutError), /timed out/],
    [sdkError(Anthropic.APIConnectionError), /Could not reach/],
    [new Error('zod: expected string'), /could not be validated/],
  ] as [Reply, RegExp][])('maps a failed call to a clear error: %#', async (reply, message) => {
    const { client } = fakeClient(reply);
    const err = await new AnthropicProvider({ client }).optimizeResume(input()).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.message).toMatch(message);
  });

  it('only accepts a canonical question mapping it is confident about', async () => {
    const yes = fakeClient({ parsed_output: { canonicalQuestion: 'Are you legally authorized to work in the United States?', confidence: 0.95 } });
    const mapped = await new AnthropicProvider({ client: yes.client }).normalizeQuestion('Can you lawfully take up employment in America?');
    expect(mapped.key).toBe('work_authorization:US');
    expect(mapped.confidence).toBeLessThanOrEqual(0.9);
    const unsure = fakeClient({ parsed_output: { canonicalQuestion: 'Are you legally authorized to work in the United States?', confidence: 0.5 } });
    expect((await new AnthropicProvider({ client: unsure.client }).normalizeQuestion('Can you lawfully take up employment in America?')).key).toMatch(/^custom:/);
    const none = fakeClient();
    expect((await new AnthropicProvider({ client: none.client }).normalizeQuestion('Are you authorized to work in the US?')).key).toBe('work_authorization:US'); // local match: no call
    expect(none.requests).toHaveLength(0);
  });
});
