import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeJob, extractJobPostingFromHtml, htmlToText, inferSeniority } from '../src';

const jobs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/jobs');

describe('analyzeJob', () => {
  it('extracts a sectioned backend JD', () => {
    const a = analyzeJob(fs.readFileSync(path.join(jobs, 'backend-senior.txt'), 'utf8'));
    expect(a).toMatchObject({ title: 'Senior Backend Engineer', company: 'Globex Payments', seniority: 'senior', location: 'Seattle, WA', workArrangement: 'hybrid', employmentType: 'Full-time' });
    expect(a.requiredSkills).toEqual(expect.arrayContaining(['Python', 'AWS', 'Docker', 'Kubernetes', 'Terraform', 'SQL', 'PostgreSQL', 'CI/CD']));
    expect(a.preferredSkills).toEqual(expect.arrayContaining(['Kafka', 'Go', 'Datadog', 'Prometheus']));
    expect(a.requiredSkills).not.toContain('Kafka');
    expect(a.responsibilities).toHaveLength(7);
    expect(a.responsibilities[0]).toMatch(/^Design, build, and operate/);
    expect(a.yearsExperience).toMatchObject({ min: 5 });
    expect(a.education).toMatchObject({ level: 'bachelor', required: true, equivalentExperienceOk: true });
    expect(a.domains).toEqual(['Fintech']);
    expect(a.salary).toBe('$160,000 – $190,000 per year');
    expect(a.skillAlternatives).toContainEqual(['Datadog', 'Prometheus']);
    expect(a.keywords).toEqual(expect.arrayContaining(['Python', 'Kubernetes', 'payments']));
    expect(a.keywords.some((k) => /globex/i.test(k))).toBe(false);
  });

  it('extracts a bullet-style frontend JD and its preferred-skill phrasing', () => {
    const a = analyzeJob(fs.readFileSync(path.join(jobs, 'frontend.txt'), 'utf8'));
    expect(a.title).toBe('Frontend Engineer (React)');
    expect(a.company).toBe('Initech');
    expect(a.workArrangement).toBe('remote');
    expect(a.yearsExperience.min).toBe(3);
    expect(a.preferredSkills).toEqual(['GraphQL']); // "is a plus"
    expect(a.requiredSkills).toEqual(expect.arrayContaining(['React', 'TypeScript', 'Jest', 'Cypress']));
  });

  it('classifies unsectioned prose', () => {
    const a = analyzeJob(
      'Acme is hiring a Data Engineer. You will build ETL pipelines in Python and Airflow and maintain our Snowflake warehouse. We need 4+ years of experience with SQL. Experience with dbt is a plus. Bachelor degree preferred.',
    );
    expect(a.requiredSkills).toEqual(expect.arrayContaining(['Python', 'Airflow', 'SQL']));
    expect(a.preferredSkills).toContain('dbt');
    expect(a.yearsExperience.min).toBe(4);
    expect(a.education.required).toBe(false);
  });

  it('rejects an empty description', () => {
    expect(() => analyzeJob('   ')).toThrow(/Paste a job description|empty/i);
  });

  it('honors explicit title/company input', () => {
    expect(analyzeJob({ text: 'We need Python and AWS skills for building APIs. 3+ years of experience.', url: '', title: 'API Engineer', company: 'Hooli' })).toMatchObject({ title: 'API Engineer', company: 'Hooli' });
  });
});

describe('seniority', () => {
  it('infers level from title, then years', () => {
    expect(inferSeniority('Staff Software Engineer', null)).toBe('staff');
    expect(inferSeniority('Software Engineer II', null)).toBe('mid');
    expect(inferSeniority('Engineering Intern', null)).toBe('intern');
    expect(inferSeniority('Software Engineer', 6)).toBe('senior');
  });
});

describe('career-site HTML (Nike-style)', () => {
  it('handles "who we are looking for" sections, glyph-only bullet lines and "X, Y, or Z" alternatives', () => {
    const html = `<script type="application/ld+json">{"@type":"JobPosting","title":"Software Engineer II, ITC","hiringOrganization":{"name":"Nike"},
      "description":"<p>WHO WE ARE LOOKING FOR</p><ul><li><span>•</span><p>A minimum of 3–5 years of backend software development experience.</p></li><li><span>•</span><p>Strong experience designing microservices and RESTful services using Java, Python, Scala, or Node.</p></li><li><span>•</span><p>Hands-on experience working in a cloud environment (AWS, GCP, or Azure).</p></li><li><span>•</span><p>Preferred: experience with NoSQL stores (Cassandra, DynamoDB, MongoDB).</p></li></ul><p>WHAT YOU'LL WORK ON</p><ul><li><p>You will build and own backend services that expose curated data.</p></li></ul>"}</script>`;
    const posting = extractJobPostingFromHtml(html);
    expect(posting.text).not.toMatch(/^•\s*$/m);
    const a = analyzeJob({ text: posting.text, url: '', title: posting.title, company: posting.company });
    expect(a).toMatchObject({ title: 'Software Engineer II, ITC', company: 'Nike' });
    expect(a.requiredSkills).toEqual(expect.arrayContaining(['Java', 'Python', 'AWS', 'Microservices', 'REST APIs']));
    expect(a.preferredSkills).toEqual(expect.arrayContaining(['Cassandra', 'DynamoDB']));
    expect(a.skillAlternatives).toEqual(expect.arrayContaining([['Java', 'Python', 'Scala', 'Node.js'], ['AWS', 'GCP', 'Azure']]));
    expect(a.responsibilities).toEqual(['You will build and own backend services that expose curated data.']);
    expect(a.yearsExperience).toMatchObject({ min: 3, max: 5 });
  });
});

describe('HTML import', () => {
  it('prefers JSON-LD JobPosting', () => {
    const html = `<html><head><title>Careers</title><script type="application/ld+json">{"@type":"JobPosting","title":"SRE","hiringOrganization":{"name":"Initech"},"description":"&lt;p&gt;Run &lt;b&gt;Kubernetes&lt;/b&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;On-call&lt;/li&gt;&lt;/ul&gt;","jobLocation":{"address":{"addressLocality":"Austin","addressRegion":"TX"}}}</script></head><body>ignored</body></html>`;
    const p = extractJobPostingFromHtml(html);
    expect(p).toMatchObject({ title: 'SRE', company: 'Initech', location: 'Austin, TX' });
    expect(p.text).toContain('Run Kubernetes');
    expect(p.text).toContain('• On-call');
  });
  it('strips scripts and styles from page text', () => {
    expect(htmlToText('<main><h1>Role</h1><script>alert(1)</script><style>p{}</style><p>Build &amp; ship</p></main>')).toMatch(/^Role\n+Build & ship$/);
  });
});
