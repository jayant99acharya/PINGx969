import {
  DEFAULT_WEIGHTS,
  DEGREE_RANK,
  DimensionDescriptions,
  DimensionKeys,
  DimensionLabels,
  type DimensionKey,
  type DimensionResult,
  type JobAnalysis,
  type MatchResult,
  type ResumeData,
  type ResumeDocument,
  type ScoringWeights,
  type Seniority,
  type SkillAssessment,
  type SkillStatus,
  containment,
  escapeRegExp,
  familyMembers,
  findSkills,
  getSkill,
  termSet,
} from '@pingx969/shared';
import { inferSeniority } from '@pingx969/job-parser';
import { type FactBase, buildFactBase } from './facts';

export interface MatchOptions {
  weights?: Partial<ScoringWeights>;
  confirmedSkills?: string[];
  yearsOverride?: number | null;
  now?: Date;
  document?: Pick<ResumeDocument, 'structure' | 'format' | 'lines'> | null;
}

const CREDIT: Record<SkillStatus, number> = { matched: 1, partial: 0.5, transferable: 0.35, missing: 0 };

/** Assess one job skill against the candidate's facts. */
export function assessSkill(skill: string, required: boolean, facts: FactBase, job: JobAnalysis): SkillAssessment {
  const base = { skill, required, via: null as string | null, evidence: [] as string[], inSkillsSection: facts.skillsSection.has(skill) };
  if (facts.skills.has(skill)) return { ...base, status: 'matched', evidence: facts.skills.get(skill)! };
  const via = facts.implied.get(skill);
  if (via) return { ...base, status: 'matched', via, evidence: [`Implied by ${via}`, ...(facts.skills.get(via) ?? []).slice(0, 1)] };
  // "Java or Go": any alternative satisfies the group
  for (const group of job.skillAlternatives) {
    if (!group.includes(skill)) continue;
    const alt = group.find((g) => g !== skill && (facts.skills.has(g) || facts.implied.has(g)));
    if (alt) return { ...base, status: 'matched', via: alt, evidence: [`The job accepts ${group.join(' or ')}; you have ${alt}`] };
  }
  // Partial: the job skill implies something the candidate has (job wants "AWS Lambda", candidate has "AWS")
  const entry = getSkill(skill);
  if (!entry) {
    // Not in the taxonomy (e.g. an AI-extracted niche tool): plain text presence.
    const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(skill)}(?![A-Za-z0-9])`, 'i');
    const line = facts.allText.split('\n').find((l) => re.test(l));
    return line ? { ...base, status: 'matched', evidence: [`"${line.slice(0, 160)}"`] } : { ...base, status: 'missing' };
  }
  const impliedHave = (entry?.implies ?? []).filter((s) => facts.skills.has(s));
  if (impliedHave.length) {
    return { ...base, status: 'partial', via: impliedHave[0], evidence: [`You have ${impliedHave.join(', ')}, a broader/related skill`] };
  }
  const fam = familyMembers(skill).filter((s) => facts.skills.has(s));
  if (fam.length) {
    return { ...base, status: 'transferable', via: fam[0], evidence: [`Related experience: ${fam.join(', ')}`] };
  }
  return { ...base, status: 'missing' };
}

export function matchResume(data: ResumeData, job: JobAnalysis, opts: MatchOptions = {}): MatchResult {
  const weights: ScoringWeights = { ...DEFAULT_WEIGHTS, ...(opts.weights ?? {}) };
  const facts = buildFactBase(data, { confirmedSkills: opts.confirmedSkills, yearsOverride: opts.yearsOverride, now: opts.now });
  const dims: DimensionResult[] = [];

  // ---- Skills
  const skillAssessments: SkillAssessment[] = [
    ...job.requiredSkills.map((s) => assessSkill(s, true, facts, job)),
    ...job.preferredSkills.map((s) => assessSkill(s, false, facts, job)),
  ];
  {
    let got = 0;
    let max = 0;
    for (const a of skillAssessments) {
      const w = a.required ? 1 : 0.5;
      max += w;
      got += w * CREDIT[a.status];
    }
    const missingReq = skillAssessments.filter((a) => a.required && a.status === 'missing').map((a) => a.skill);
    dims.push(
      dim('skills', max ? (got / max) * 100 : 0, weights, max > 0, missingReq.length ? `Missing required: ${missingReq.join(', ')}` : max ? 'All required skills are covered.' : 'The job lists no recognizable skills.',
        skillAssessments.map((a) => ({
          label: `${a.skill}${a.required ? '' : ' (preferred)'}`,
          status: a.status === 'matched' ? 'pass' : a.status === 'missing' ? 'fail' : 'partial',
          note: a.status === 'matched' ? (a.via ? `via ${a.via}` : '') : a.status === 'missing' ? 'Not found in your resume' : `${a.status}${a.via ? ` — ${a.via}` : ''}`,
        })),
      ),
    );
  }

  // ---- Experience (years)
  {
    const years = facts.months / 12;
    const req = job.yearsExperience.min;
    let score = 100;
    let summary: string;
    const details: DimensionResult['details'] = [{ label: `Your experience: ${fmtYears(years)}`, status: 'info', note: 'Computed from your dated roles; overlapping roles are counted once.' }];
    if (req === null) {
      summary = 'The job does not state a years-of-experience requirement.';
    } else {
      if (years >= req) {
        score = 100;
        summary = `${fmtYears(years)} meets the ${req}+ years requirement.`;
        if (job.yearsExperience.max !== null && years > job.yearsExperience.max + 5) {
          score = 85;
          summary += ' You may be considered over-qualified for this range.';
        }
      } else {
        score = Math.max(0, Math.pow(years / req, 1.3) * 100);
        summary = `${fmtYears(years)} vs ${req}+ years required.`;
      }
      details.push({ label: `Required: ${job.yearsExperience.text || `${req}+ years`}`, status: years >= req ? 'pass' : years >= req * 0.75 ? 'partial' : 'fail', note: '' });
    }
    dims.push(dim('experience', score, weights, req !== null, summary, details));
  }

  // ---- Responsibilities
  {
    const units = [
      ...data.experience.flatMap((e) => e.bullets.map((b) => ({ text: b.text, where: [e.title, e.company].filter(Boolean).join(' @ ') }))),
      ...data.projects.flatMap((p) => [p.description, ...p.bullets.map((b) => b.text)].filter(Boolean).map((t) => ({ text: t, where: `Project ${p.name}` }))),
      ...(data.summary.text ? [{ text: data.summary.text, where: 'Summary' }] : []),
    ].map((u) => ({ ...u, terms: termSet(u.text), skills: new Set(findSkills(u.text).map((m) => m.name)) }));
    const whole = termSet(facts.allText);
    const details: DimensionResult['details'] = [];
    let total = 0;
    for (const r of job.responsibilities) {
      const rt = termSet(r);
      const rSkills = findSkills(r).map((m) => m.name);
      let best = 0;
      let bestText = '';
      for (const u of units) {
        let sim = containment(rt, u.terms);
        if (rSkills.length) sim = 0.7 * sim + 0.3 * (rSkills.filter((s) => u.skills.has(s)).length / rSkills.length);
        if (sim > best) {
          best = sim;
          bestText = `${u.where}: "${u.text}"`;
        }
      }
      const overall = containment(rt, whole) * 0.7;
      const credit = Math.min(1, Math.max(best, overall) / 0.5);
      total += credit;
      details.push({
        label: r,
        status: credit >= 0.8 ? 'pass' : credit >= 0.4 ? 'partial' : 'fail',
        note: best > 0.15 ? `Closest: ${bestText}` : 'No closely matching experience found',
      });
    }
    const n = job.responsibilities.length;
    dims.push(dim('responsibilities', n ? (total / n) * 100 : 0, weights, n > 0, n ? `${details.filter((d) => d.status === 'pass').length} of ${n} responsibilities clearly reflected in your experience.` : 'No responsibilities listed.', details));
  }

  // ---- Keywords (exact wording, ATS style)
  {
    const text = facts.allText;
    const details: DimensionResult['details'] = [];
    let got = 0;
    for (const kw of job.keywords) {
      const exact = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(kw).replace(/\s+/g, '[\\s-]+')}(?![A-Za-z0-9])`, 'i').test(text);
      if (exact) {
        got += 1;
        details.push({ label: kw, status: 'pass', note: '' });
        continue;
      }
      const canon = findSkills(kw)[0]?.name;
      if (canon && (facts.skills.has(canon) || facts.implied.has(canon))) {
        got += 0.5;
        const yours = findSkills(text).find((m) => m.name === canon)?.surface;
        details.push({ label: kw, status: 'partial', note: yours ? `You wrote "${yours}"; the job says "${kw}"` : `Implied by ${facts.implied.get(canon) ?? 'related skill'}` });
      } else details.push({ label: kw, status: 'fail', note: 'Not in your resume' });
    }
    const n = job.keywords.length;
    dims.push(dim('keywords', n ? (got / n) * 100 : 0, weights, n > 0, n ? `${details.filter((d) => d.status === 'pass').length} of ${n} job keywords appear verbatim.` : 'No keywords extracted.', details));
  }

  // ---- Education
  {
    const req = job.education.level;
    const have = facts.highestDegree;
    let score = 100;
    let summary: string;
    if (req === 'none') summary = 'No degree requirement stated.';
    else if (DEGREE_RANK[have] >= DEGREE_RANK[req]) summary = `Your ${have} degree meets the ${req} requirement.`;
    else {
      const yearsOk = facts.months / 12 >= 4;
      score = job.education.equivalentExperienceOk && yearsOk ? 80 : (DEGREE_RANK[have] / DEGREE_RANK[req]) * 60;
      if (!job.education.required) score = Math.max(score, 70);
      summary = job.education.equivalentExperienceOk && yearsOk ? `The job accepts equivalent experience in place of a ${req} degree.` : `The job asks for a ${req} degree; your highest detected degree is ${have}.`;
    }
    const fieldMatch = job.education.fields.length === 0 || job.education.fields.some((f) => /related/.test(f) || facts.degreeFields.some((g) => g.includes(f) || f.includes(g)));
    dims.push(
      dim('education', score, weights, req !== 'none', summary, [
        { label: `Required: ${job.education.text || req}`, status: score >= 100 ? 'pass' : score >= 70 ? 'partial' : 'fail', note: '' },
        ...(job.education.fields.length ? [{ label: `Field: ${job.education.fields.join(', ')}`, status: fieldMatch ? ('pass' as const) : ('partial' as const), note: facts.degreeFields.join(', ') }] : []),
      ]),
    );
  }

  // ---- Seniority
  {
    const jobLevel = job.seniority;
    const latestTitle = data.experience[0]?.title ?? '';
    const titleLevel = inferSeniority(latestTitle, null);
    const years = facts.months / 12;
    const yearsLevel: Seniority = years >= 8 ? 'staff' : years >= 5 ? 'senior' : years >= 2 ? 'mid' : 'junior';
    const candLevel = latestTitle && titleLevel !== 'mid' && titleLevel !== 'unknown' ? titleLevel : yearsLevel;
    const diff = LEVEL[jobLevel] - LEVEL[candLevel];
    let score = 100;
    let summary = `Your level (${candLevel}) matches the ${jobLevel} level of this role.`;
    if (jobLevel === 'unknown') summary = 'Job level could not be determined.';
    else if (diff <= -2) {
      score = 80;
      summary = `Your level (${candLevel}) is above this ${jobLevel} role.`;
    } else if (diff > 0.5) {
      score = diff <= 1 ? 75 : diff <= 2 ? 45 : 20;
      summary = `This ${jobLevel} role is ${diff <= 1 ? 'a step' : 'several steps'} above your current level (${candLevel}).`;
    }
    dims.push(
      dim('seniority', score, weights, jobLevel !== 'unknown', summary, [
        { label: `Job level: ${jobLevel}`, status: 'info', note: job.title },
        { label: `Your level: ${candLevel}`, status: 'info', note: latestTitle ? `Most recent title "${latestTitle}", ${fmtYears(years)}` : fmtYears(years) },
      ]),
    );
  }

  // ---- Technology
  {
    const techs = job.technologies;
    let got = 0;
    let max = 0;
    const details: DimensionResult['details'] = [];
    for (const t of techs) {
      const w = Math.min(3, job.technologyCounts[t] ?? 1);
      const a = assessSkill(t, true, facts, job);
      max += w;
      got += w * CREDIT[a.status];
      details.push({ label: t, status: a.status === 'matched' ? 'pass' : a.status === 'missing' ? 'fail' : 'partial', note: a.via ? `via ${a.via}` : a.status === 'missing' ? 'Not in your resume' : '' });
    }
    dims.push(dim('technology', max ? (got / max) * 100 : 0, weights, techs.length > 0, techs.length ? `${details.filter((d) => d.status === 'pass').length} of ${techs.length} technologies covered.` : 'No technologies mentioned.', details));
  }

  // ---- Domain
  {
    const jd = job.domains;
    const have = [...facts.domains.keys()];
    const matched = jd.filter((d) => facts.domains.has(d));
    dims.push(
      dim('domain', jd.length ? (matched.length / jd.length) * 100 : 0, weights, jd.length > 0, jd.length ? (matched.length ? `Shared domain: ${matched.join(', ')}` : `No ${jd.join('/')} background found${have.length ? ` (your background: ${have.join(', ')})` : ''}.`) : 'No specific industry domain detected.',
        jd.map((d) => ({ label: d, status: facts.domains.has(d) ? ('pass' as const) : ('fail' as const), note: facts.domains.get(d)?.join(', ') ?? '' })),
      ),
    );
  }

  // ---- ATS compatibility
  dims.push(atsDimension(data, opts.document ?? null, weights));

  const applicable = dims.filter((d) => d.applicable && d.weight > 0);
  const wsum = applicable.reduce((n, d) => n + d.weight, 0);
  const overall = wsum ? applicable.reduce((n, d) => n + d.score * d.weight, 0) / wsum : 0;

  const excluded = dims.filter((d) => !d.applicable).map((d) => d.label);
  const methodology =
    `Overall = weighted average of ${applicable.map((d) => `${d.label} (${d.weight})`).join(', ')}.` +
    (excluded.length ? ` Not applicable for this job, so excluded: ${excluded.join(', ')}.` : '') +
    ' Weights are configurable in Settings. Scores use only information found in your resume or confirmed in your profile.';

  return {
    overall: Math.round(overall),
    dimensions: dims.map((d) => ({ ...d, score: Math.round(d.score) })),
    skills: skillAssessments,
    weights,
    methodology,
  };
}

const LEVEL: Record<Seniority, number> = { intern: 0, junior: 1, mid: 2, senior: 3, lead: 3.5, staff: 4, manager: 4, principal: 5, director: 6, unknown: 2 };

function fmtYears(y: number): string {
  const r = Math.round(y * 10) / 10;
  return `${r} ${r === 1 ? 'year' : 'years'}`;
}

function dim(key: DimensionKey, score: number, weights: ScoringWeights, applicable: boolean, summary: string, details: DimensionResult['details']): DimensionResult {
  return { key, label: DimensionLabels[key], score: Math.max(0, Math.min(100, score)), weight: weights[key], applicable, summary, details };
}

export function atsDimension(data: ResumeData, document: Pick<ResumeDocument, 'structure' | 'format' | 'lines'> | null, weights: ScoringWeights): DimensionResult {
  const has = (s: string) => data.headings.some((h) => h.section === s);
  const words = (document?.lines.map((l) => l.text).join(' ') ?? '').split(/\s+/).filter(Boolean).length;
  const st = document?.structure;
  const checks: { label: string; ok: boolean; w: number; fix: string }[] = [
    { label: 'Email address present', ok: !!data.personal.email, w: 2, fix: 'Add an email address near your name.' },
    { label: 'Phone number present', ok: !!data.personal.phone, w: 1, fix: 'Add a phone number.' },
    { label: 'Standard "Experience" heading', ok: has('experience'), w: 2, fix: 'Use a heading such as "Experience" or "Work Experience".' },
    { label: 'Standard "Education" heading', ok: has('education') || !data.education.length, w: 1, fix: 'Use a heading such as "Education".' },
    { label: 'Dedicated "Skills" section', ok: has('skills'), w: 1, fix: 'Add a Skills section listing your technologies.' },
    { label: 'Parseable dates on every role', ok: data.experience.length > 0 && data.experience.every((e) => !!e.startDate), w: 2, fix: 'Use dates like "Mar 2021 – Present" on each role.' },
    { label: 'Job titles detected', ok: data.experience.length > 0 && data.experience.every((e) => !!e.title), w: 1, fix: 'Put each job title on its own line or before the company name.' },
    { label: 'Bullet points for achievements', ok: data.experience.some((e) => e.bullets.length >= 2), w: 1, fix: 'Describe each role with 2–6 bullet points.' },
    { label: 'No layout tables', ok: !st?.hasTables, w: 1, fix: 'Avoid tables for layout; many ATS read them out of order.' },
    { label: 'No text boxes', ok: !st?.hasTextBoxes, w: 1, fix: 'Move text out of text boxes.' },
    { label: 'Single-column layout', ok: !st?.multiColumn, w: 1, fix: 'Single-column layouts parse most reliably.' },
    { label: 'Contact info not only in header/footer', ok: !st?.hasHeaderFooterText || !!data.personal.email, w: 1, fix: 'Keep contact info in the document body.' },
    { label: 'Reasonable length (250–1,100 words)', ok: words === 0 || (words >= 250 && words <= 1100), w: 1, fix: words < 250 ? 'Your resume is quite short; add detail to your roles.' : 'Consider trimming to the most relevant content.' },
  ];
  const total = checks.reduce((n, c) => n + c.w, 0);
  const got = checks.reduce((n, c) => n + (c.ok ? c.w : 0), 0);
  const failed = checks.filter((c) => !c.ok);
  return dim('ats', (got / total) * 100, weights, true, failed.length ? `${failed.length} formatting issue${failed.length > 1 ? 's' : ''} may affect ATS parsing.` : 'Your resume structure is ATS-friendly.',
    checks.map((c) => ({ label: c.label, status: c.ok ? 'pass' : 'fail', note: c.ok ? '' : c.fix })),
  );
}

export const DIMENSION_INFO = DimensionKeys.map((k) => ({ key: k, label: DimensionLabels[k], description: DimensionDescriptions[k], defaultWeight: DEFAULT_WEIGHTS[k] }));
