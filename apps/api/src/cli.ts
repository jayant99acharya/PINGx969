/**
 * Database CLI:
 *   migrate  — apply pending SQL migrations
 *   seed     — create a demo account with a parsed resume, a job, a version, answers and applications
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '@pingx969/database';
import { parseResume } from '@pingx969/resume-parser';
import { analyzeJob } from '@pingx969/job-parser';
import { profileFromResume } from '@pingx969/profile';
import { loadConfig } from './config';
import { createContext } from './context';
import { createOptimizedVersion } from './services/versions';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const DEMO = { email: 'demo@pingx969.local', password: 'demo-password-123', name: 'Jane Doe' };

async function main() {
  const cmd = process.argv[2];
  const config = loadConfig();
  const ctx = await createContext(config); // createContext runs migrations
  if (cmd === 'migrate') {
    console.log(`[db] Migrations are up to date (${ctx.db.kind}).`);
  } else if (cmd === 'seed') {
    if (await ctx.repos.findUserByEmail(DEMO.email)) {
      console.log(`[seed] Demo user already exists: ${DEMO.email} / ${DEMO.password}`);
    } else {
      const user = await ctx.repos.createUser(DEMO.email, await hashPassword(DEMO.password), DEMO.name);
      const file = path.join(root, 'fixtures/resumes/jane-doe.docx');
      const bytes = new Uint8Array(fs.readFileSync(file));
      const parsed = await parseResume(bytes, 'jane-doe.docx');
      const key = `${user.id}/resumes/seed-resume`;
      await ctx.store.put(key, bytes);
      const docId = await ctx.repos.createDocument(user.id, { kind: 'resume_source', filename: 'jane-doe.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: bytes.length, sha256: 'seed', storageKey: key });
      const resume = await ctx.repos.createResume(user.id, 'Jane Doe — Base resume', 'docx', docId, parsed);
      const { profile } = await ctx.repos.getProfile(user.id);
      const p = profileFromResume(profile, parsed.data);
      p.location.country = 'United States';
      p.workAuthorization.authorizedCountries = ['United States'];
      p.workAuthorization.requiresSponsorship = 'no';
      p.preferences.noticePeriod = '2 weeks';
      await ctx.repos.saveProfile(user.id, p);
      const jd = fs.readFileSync(path.join(root, 'fixtures/jobs/backend-senior.txt'), 'utf8');
      const analysis = analyzeJob(jd);
      const { job } = await ctx.repos.createJob(
        user.id,
        { title: analysis.title, company: analysis.company, url: 'http://localhost:4100/greenhouse.html', location: analysis.location, seniority: analysis.seniority, workArrangement: analysis.workArrangement, source: 'manual' },
        { rawText: jd, source: 'paste', analysis, provider: 'heuristic' },
      );
      const { version } = await createOptimizedVersion(ctx, user.id, resume.id, job.id, { provider: 'heuristic' });
      await ctx.repos.createApplication(user.id, { company: job.company, jobTitle: job.title, jobUrl: job.url, status: 'preparing', resumeVersionId: version.id, jobId: job.id, matchScore: version.matchAfter });
      await ctx.repos.createApplication(user.id, { company: 'Initech', jobTitle: 'Frontend Engineer', jobUrl: 'https://example.com/jobs/initech-frontend', status: 'interview', matchScore: 71 });
      console.log(`[seed] Created demo user ${DEMO.email} / ${DEMO.password}`);
    }
  } else {
    console.log('Usage: tsx apps/api/src/cli.ts <migrate|seed>');
    process.exitCode = 1;
  }
  await ctx.db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
