import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { parseResume } from '@pingx969/resume-parser';
import { fixture, makeApp, register, type Session } from './helpers';

let app: Express;
let s: Session;

beforeAll(async () => {
  ({ app } = await makeApp());
  s = await register(app);
});

const post = (url: string) => s.agent.post(url).set('X-CSRF-Token', s.csrf);
const patch = (url: string) => s.agent.patch(url).set('X-CSRF-Token', s.csrf);

describe('Resume → job → optimize → version pipeline', () => {
  let resumeId: string;
  let jobId: string;
  let versionId: string;
  let originalData: Record<string, unknown>;

  it('uploads and parses a DOCX resume', async () => {
    const res = await post('/api/resumes').attach('file', fixture('resumes/jane-doe.docx'), 'jane-doe.docx').expect(201);
    resumeId = res.body.resume.id;
    const d = res.body.data;
    expect(d.personal.name).toBe('Jane Doe');
    expect(d.personal.email).toBe('jane.doe@example.com');
    expect(d.experience).toHaveLength(2);
    expect(d.experience[0]).toMatchObject({ title: 'Senior Software Engineer', company: 'Northwind Commerce', startDate: '2021-03', endDate: 'present' });
    expect(d.experience[0].bullets).toHaveLength(5);
    expect(d.skills.map((g: { category: string }) => g.category)).toEqual(['Languages', 'Frameworks', 'Cloud & Tools']);
    expect(res.body.profileUpdated).toBe(true);
    originalData = d;
  });

  it('saves the resume and lists it', async () => {
    const list = await s.agent.get('/api/resumes').expect(200);
    expect(list.body.resumes).toHaveLength(1);
    expect(list.body.resumes[0].isDefault).toBe(true);
    const one = await s.agent.get(`/api/resumes/${resumeId}`).expect(200);
    expect(one.body.capabilities.find((c: { format: string }) => c.format === 'docx').fidelity).toBe('original-patched');
  });

  it('imports resume details into the profile', async () => {
    const res = await s.agent.get('/api/profile').expect(200);
    expect(res.body.profile.personal.phone).toBe('(206) 555-0142');
    expect(res.body.profile.links.linkedin).toContain('linkedin.com/in/janedoe');
    expect(res.body.profile.experience[0].company).toBe('Northwind Commerce');
  });

  it('adds and analyzes a job description', async () => {
    const res = await post('/api/jobs').send({ text: fixture('jobs/backend-senior.txt').toString('utf8'), url: 'https://boards.example.com/globex/jobs/123' }).expect(201);
    jobId = res.body.job.id;
    const a = res.body.analysis;
    expect(a.title).toBe('Senior Backend Engineer');
    expect(a.company).toBe('Globex Payments');
    expect(a.requiredSkills).toEqual(expect.arrayContaining(['Python', 'AWS', 'Kubernetes', 'Terraform', 'Docker']));
    expect(a.preferredSkills).toEqual(expect.arrayContaining(['Kafka', 'Go']));
    expect(a.yearsExperience.min).toBe(5);
    expect(a.education.level).toBe('bachelor');
  });

  it('computes a transparent multi-dimension match score', async () => {
    const res = await post(`/api/resumes/${resumeId}/match`).send({ jobId }).expect(200);
    const m = res.body.match;
    expect(m.overall).toBeGreaterThan(50);
    expect(m.overall).toBeLessThan(95);
    const keys = m.dimensions.map((d: { key: string }) => d.key);
    expect(keys).toEqual(['skills', 'experience', 'responsibilities', 'keywords', 'education', 'seniority', 'technology', 'domain', 'ats']);
    const k8s = m.skills.find((x: { skill: string }) => x.skill === 'Kubernetes');
    expect(k8s.status).toBe('transferable');
    expect(m.skills.find((x: { skill: string }) => x.skill === 'Terraform').status).toBe('missing');
  });

  it('generates an optimized version without fabrication', async () => {
    const res = await post('/api/versions').send({ resumeId, jobId }).expect(201);
    versionId = res.body.version.id;
    const p = res.body.payload;
    const allSkills = p.optimized.skills.flatMap((g: { items: string[] }) => g.items);
    // Never adds skills the candidate doesn't have
    expect(allSkills).not.toContain('Kubernetes');
    expect(allSkills).not.toContain('Terraform');
    expect(allSkills).not.toContain('Kafka');
    // Prioritizes relevant skills
    expect(p.optimized.skills[0].items[0]).toBe('Python');
    // Reports what was not added, with reasons
    const notAdded = p.changes.filter((c: { kind: string }) => c.kind === 'skill_not_added').map((c: { target: { skill: string } }) => c.target.skill);
    expect(notAdded).toEqual(expect.arrayContaining(['Kubernetes', 'Terraform', 'Kafka']));
    // Employers, titles and dates are untouched
    expect(p.optimized.experience.map((e: { company: string; title: string; startDate: string }) => [e.company, e.title, e.startDate])).toEqual(
      (originalData.experience as { company: string; title: string; startDate: string }[]).map((e) => [e.company, e.title, e.startDate]),
    );
    // Every accepted change has provenance and evidence/reason
    for (const c of p.changes) {
      expect(['fact', 'inference', 'suggestion', 'missing', 'user_confirmed']).toContain(c.provenance);
      expect(c.reason.length).toBeGreaterThan(5);
    }
    // Suggestions with placeholders are never applied automatically
    expect(p.changes.filter((c: { hasPlaceholder: boolean; accepted: boolean }) => c.hasPlaceholder && c.accepted)).toHaveLength(0);
  });

  it('retrieves the version and leaves the original resume unchanged', async () => {
    const v = await s.agent.get(`/api/versions/${versionId}`).expect(200);
    expect(v.body.version.label).toMatch(/^Globex Payments — Senior Backend Engineer — /);
    expect(v.body.version.matchAfter).toBeGreaterThanOrEqual(v.body.version.matchBefore);
    const orig = await s.agent.get(`/api/resumes/${resumeId}`).expect(200);
    expect(orig.body.data).toEqual(originalData);
    const list = await s.agent.get(`/api/versions?resumeId=${resumeId}`).expect(200);
    expect(list.body.versions).toHaveLength(1);
  });

  it('accepts/rejects/edits individual changes and recomputes', async () => {
    const v = await s.agent.get(`/api/versions/${versionId}`).expect(200);
    const changes = v.body.payload.changes;
    const reorder = changes.find((c: { kind: string }) => c.kind === 'skills_reordered');
    const suggestion = changes.find((c: { kind: string }) => c.kind === 'suggestion');
    const res = await patch(`/api/versions/${versionId}`)
      .send({ decisions: [{ id: reorder.id, accepted: false }, { id: suggestion.id, after: suggestion.before.replace(/\.$/, ', supporting 40 internal users.') }] })
      .expect(200);
    const opt = res.body.payload.optimized;
    expect(opt.skills.find((g: { id: string }) => g.id === reorder.target.skillGroupId).items).toEqual(reorder.before);
    expect(JSON.stringify(opt)).toContain('supporting 40 internal users');
    // Blocked or informational changes can't be force-accepted
    const notAdded = changes.find((c: { kind: string }) => c.kind === 'skill_not_added');
    await patch(`/api/versions/${versionId}`).send({ decisions: [{ id: notAdded.id, accepted: true }] }).expect(400);
  });

  it('confirming a skill adds it as user-confirmed and saves it to the profile', async () => {
    const v = await s.agent.get(`/api/versions/${versionId}`).expect(200);
    const go = v.body.payload.changes.find((c: { kind: string; target: { skill?: string } }) => c.kind === 'skill_not_added' && c.target.skill === 'Go');
    const res = await patch(`/api/versions/${versionId}`).send({ decisions: [{ id: go.id, confirmSkill: true }] }).expect(200);
    const added = res.body.payload.changes.find((c: { id: string }) => c.id === go.id);
    expect(added.kind).toBe('skill_added');
    expect(added.provenance).toBe('user_confirmed');
    const prof = await s.agent.get('/api/profile').expect(200);
    expect(prof.body.profile.confirmedSkills).toContain('Go');
  });

  it('exports PDF, DOCX and JSON that round-trip through the parser', async () => {
    for (const fmt of ['pdf', 'docx'] as const) {
      const res = await s.agent.get(`/api/versions/${versionId}/export?format=${fmt}`).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      }).expect(200);
      expect(res.headers['content-disposition']).toContain(`.${fmt}`);
      const back = await parseResume(new Uint8Array(res.body as Buffer), `x.${fmt}`);
      expect(back.data.experience).toHaveLength(2);
      expect(back.data.personal.email).toBe('jane.doe@example.com');
      expect(back.rawText).toContain('supporting 40 internal users');
      expect(back.rawText).not.toContain('Kubernetes');
      if (fmt === 'docx') expect(res.headers['x-export-fidelity']).toBe('original-patched');
    }
    const json = await s.agent.get(`/api/versions/${versionId}/export?format=json`).expect(200);
    expect(json.body.format).toBe('pingx969/v1');
    expect(json.body.resume.experience[0].company).toBe('Northwind Commerce');
  });

  it('refuses to export unfilled placeholders unless forced', async () => {
    const v = await s.agent.get(`/api/versions/${versionId}`).expect(200);
    const sug = v.body.payload.changes.find((c: { kind: string; edited: boolean }) => c.kind === 'suggestion' && !c.edited);
    if (!sug) return;
    await patch(`/api/versions/${versionId}`).send({ decisions: [{ id: sug.id, accepted: true }] }).expect(200);
    const res = await s.agent.get(`/api/versions/${versionId}/export?format=pdf`).expect(409);
    expect(res.body.error.message).toMatch(/placeholder/);
    await s.agent.get(`/api/versions/${versionId}/export?format=pdf&force=1`).expect(200);
    await patch(`/api/versions/${versionId}`).send({ decisions: [{ id: sug.id, accepted: false }] }).expect(200);
  });
});

describe('Skills-only optimization (PDF kept as-is)', () => {
  it('appends job skills to the original PDF and changes nothing else', async () => {
    const up = await post('/api/resumes').attach('file', fixture('resumes/alex-table.pdf'), 'alex-table.pdf').expect(201);
    const resumeId = up.body.resume.id;
    const job = await post('/api/jobs').send({ text: fixture('jobs/backend-senior.txt').toString('utf8') }).expect(201);
    const v = await post('/api/versions').send({ resumeId, jobId: job.body.job.id, scope: 'skills' }).expect(201);
    expect(v.body.version.label).toMatch(/Skills only$/);
    const changes = v.body.payload.changes as { id: string; kind: string; target: { skill?: string } }[];
    // Only appends: skills evidenced elsewhere in the resume, plus a list of job skills not found
    expect(changes.every((c) => c.kind === 'skill_added' || c.kind === 'skill_not_added')).toBe(true);
    const evidenced = changes.filter((c) => c.kind === 'skill_added').map((c) => (c as { after?: string }).after);
    // the user confirms all job skills
    const missing = changes.filter((c) => c.kind === 'skill_not_added');
    const res = await patch(`/api/versions/${v.body.version.id}`).send({ decisions: missing.map((c) => ({ id: c.id, confirmSkill: true })) }).expect(200);
    const optimized = res.body.payload.optimized;
    const orig = up.body.data;
    expect(optimized.experience).toEqual(orig.experience);
    expect(optimized.summary).toEqual(orig.summary);
    expect(optimized.skills.slice(0, -1)).toEqual(orig.skills.slice(0, -1));
    const added = optimized.skills.at(-1).items.slice(orig.skills.at(-1).items.length);
    expect(added).toEqual([...evidenced, ...missing.map((c) => c.target.skill)]);

    const pdf = await s.agent.get(`/api/versions/${v.body.version.id}/export?format=pdf`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(pdf.headers['x-export-fidelity']).toBe('original-patched');
    const back = await parseResume(new Uint8Array(pdf.body as Buffer), 'out.pdf');
    expect(back.data.skills.at(-1)!.items.slice(-added.length)).toEqual(added);
    expect(back.data.education.map((e) => e.institution)).toEqual(['IIT Bombay', 'Fergusson College']);
  });
});

describe('Job URL import', () => {
  it('fetches pages through the DNS-pinned fetcher (Node happy-eyeballs lookup)', async () => {
    const { safeFetchText } = await import('../src/services/url-fetch');
    const http = await import('node:http');
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Platform Engineer</h1><p>Python and AWS</p></body></html>');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const page = await safeFetchText(`http://localhost:${port}/job`, { allowPrivate: true });
      expect(page.body).toContain('Platform Engineer');
      await expect(safeFetchText(`http://localhost:${port}/job`)).rejects.toThrow(/private network/);
    } finally {
      server.close();
    }
  });
});

describe('Applications', () => {
  it('tracks status changes without touching other fields, and never auto-applies on upsert', async () => {
    const created = await post('/api/applications/upsert').send({ jobUrl: 'https://jobs.example.com/acme/42?utm_source=x', company: 'Acme', jobTitle: 'SWE', matchScore: 77 }).expect(201);
    const id = created.body.application.id;
    expect(created.body.application.status).toBe('preparing');
    // a second autofill on the same posting (different tracking params) reuses the record
    const again = await post('/api/applications/upsert').send({ jobUrl: 'https://jobs.example.com/acme/42', company: 'Acme', jobTitle: 'SWE' }).expect(200);
    expect(again.body.application.id).toBe(id);
    expect(again.body.application.status).toBe('preparing');
    const res = await patch(`/api/applications/${id}`).send({ status: 'applied', confirmedSubmission: true }).expect(200);
    expect(res.body.application).toMatchObject({ company: 'Acme', jobTitle: 'SWE', status: 'applied', matchScore: 77 });
    expect(res.body.application.jobUrl).toContain('jobs.example.com/acme/42');
    expect(res.body.application.appliedAt).toBeTruthy();
    const ev = await s.agent.get(`/api/applications/${id}`).expect(200);
    expect(ev.body.events.map((e: { type: string }) => e.type)).toEqual(['created', 'autofilled', 'status_changed']);
  });
});

describe('Security', () => {
  it('requires authentication', async () => {
    await request(app).get('/api/resumes').expect(401);
    await request(app).get('/api/profile').set('Authorization', 'Bearer not-a-real-token').expect(401);
  });

  it('enforces CSRF tokens for cookie sessions', async () => {
    const res = await s.agent.post('/api/answers').send({ question: 'Q?', answer: 'A' }).expect(403);
    expect(res.body.error.code).toBe('csrf_failed');
    await s.agent.post('/api/answers').set('X-CSRF-Token', s.csrf).set('Origin', 'https://evil.example').send({ question: 'Q?', answer: 'A' }).expect(403);
  });

  it('isolates users from each other', async () => {
    const other = await register(app);
    const mine = await s.agent.get('/api/resumes').expect(200);
    const id = mine.body.resumes[0].id;
    await other.agent.get(`/api/resumes/${id}`).expect(404);
    await other.agent.delete(`/api/resumes/${id}`).set('X-CSRF-Token', other.csrf).expect(404);
    const theirs = await other.agent.get('/api/applications').expect(200);
    expect(theirs.body.applications).toHaveLength(0);
  });

  it('issues extension bearer tokens that bypass cookies/CSRF but not auth', async () => {
    const email = `ext${Date.now()}@example.com`;
    await register(app, email, 'extension-password-1');
    const login = await request(app).post('/api/auth/login').send({ email, password: 'extension-password-1', client: 'extension' }).expect(200);
    expect(login.body.token).toBeTruthy();
    expect(login.headers['set-cookie']).toBeUndefined();
    const boot = await request(app).get('/api/autofill/bootstrap').set('Authorization', `Bearer ${login.body.token}`).expect(200);
    expect(boot.body.profile).toBeTruthy();
    await request(app).post('/api/answers').set('Authorization', `Bearer ${login.body.token}`).send({ question: 'Are you legally authorized to work in the US?', answer: 'Yes' }).expect(201);
  });

  it('rejects wrong passwords and duplicate registration', async () => {
    const email = `dup${Date.now()}@example.com`;
    await register(app, email);
    await request(app).post('/api/auth/register').send({ email, password: 'another-password-1', name: 'X' }).expect(409);
    await request(app).post('/api/auth/login').send({ email, password: 'wrong-password-123' }).expect(401);
  });

  it('sets security headers', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('Error handling', () => {
  it('rejects corrupted and unsupported files with clear messages', async () => {
    const bad = await post('/api/resumes').attach('file', fixture('resumes/corrupted.pdf'), 'corrupted.pdf').expect(422);
    expect(bad.body.error.code).toBe('corrupted_file');
    const exe = await post('/api/resumes').attach('file', fixture('resumes/not-a-resume.exe'), 'resume.exe').expect(415);
    expect(exe.body.error.message).toMatch(/Unsupported/);
    const fake = await post('/api/resumes').attach('file', fixture('resumes/not-a-resume.exe'), 'resume.pdf').expect(415);
    expect(fake.body.error.code).toBe('unsupported_file');
  });

  it('rejects oversized uploads', async () => {
    const big = Buffer.alloc(6 * 1024 * 1024, 'a');
    const res = await post('/api/resumes').attach('file', big, 'big.txt').expect(413);
    expect(res.body.error.code).toBe('file_too_large');
  });

  it('rejects an empty job description', async () => {
    const res = await post('/api/jobs').send({ text: '   ' }).expect(422);
    expect(res.body.error.code).toBe('empty_job_description');
  });

  it('blocks job URLs that point to private networks (SSRF)', async () => {
    const res = await post('/api/jobs').send({ url: 'http://127.0.0.1:4000/api/health' }).expect(400);
    expect(res.body.error.message).toMatch(/private network/);
  });

  it('returns validation errors for malformed input', async () => {
    const res = await patch('/api/applications/not-a-uuid').send({ status: 'nonsense' }).expect(400);
    expect(res.body.error.code).toBe('validation_error');
  });
});
