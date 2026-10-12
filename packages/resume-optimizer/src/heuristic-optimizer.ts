import {
  type Bullet,
  type Change,
  type JobAnalysis,
  type MatchResult,
  type ResumeData,
  type SkillGroup,
  TECH_CATEGORIES,
  capitalizeFirst,
  containment,
  escapeRegExp,
  findSkills,
  getSkill,
  hasMetric,
  termSet,
} from '@pingx969/shared';
import type { FactBase } from './facts';

let seq = 0;
const cid = (p: string) => `${p}-${(++seq).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** JD skill priority: required (in order), then preferred, then other technologies. */
export function jobPriority(job: JobAnalysis): string[] {
  const out: string[] = [];
  for (const s of [...job.requiredSkills, ...job.preferredSkills, ...job.technologies]) if (!out.includes(s)) out.push(s);
  return out;
}

function canonOf(item: string): string | null {
  return findSkills(item)[0]?.name ?? null;
}

// ------------------------------------------------------------------ skills

export function proposeSkillChanges(data: ResumeData, job: JobAnalysis, facts: FactBase, match: MatchResult, opts: { reorder?: boolean; appendToLast?: boolean } = {}): Change[] {
  const changes: Change[] = [];
  const priority = jobPriority(job);
  const rank = (item: string) => {
    const c = canonOf(item);
    const i = c ? priority.indexOf(c) : -1;
    return i < 0 ? Infinity : i;
  };

  // Reorder each skill group: job-relevant first (by job priority), others keep their order.
  for (const g of opts.reorder === false ? [] : data.skills) {
    const sorted = g.items
      .map((item, idx) => ({ item, idx, r: rank(item) }))
      .sort((a, b) => (a.r === b.r ? a.idx - b.idx : a.r - b.r))
      .map((x) => x.item);
    if (sorted.join('\u0000') !== g.items.join('\u0000')) {
      const relevant = sorted.filter((s) => rank(s) !== Infinity);
      changes.push({
        id: cid('skord'),
        kind: 'skills_reordered',
        section: 'skills',
        target: { skillGroupId: g.id },
        before: g.items,
        after: sorted,
        provenance: 'fact',
        evidence: [`Job-relevant skills moved first: ${relevant.join(', ')}`],
        reason: 'Skills the job asks for are listed first so recruiters and ATS see them immediately.',
        accepted: true,
        informational: false,
        blocked: null,
        hasPlaceholder: false,
        edited: false,
        source: 'heuristic',
      });
    }
  }

  // Add job skills that are evidenced elsewhere in the resume but missing from the Skills section.
  const inSection = new Set<string>();
  for (const g of data.skills) for (const i of g.items) for (const m of findSkills(i)) inSection.add(m.name);
  if (data.skills.length) {
    for (const a of match.skills) {
      if (a.status !== 'matched' || inSection.has(a.skill)) continue;
      const entry = getSkill(a.skill);
      if (!entry || !TECH_CATEGORIES.includes(entry.cat)) continue;
      // Don't add a broad parent when a specific child is listed ("SQL" when "PostgreSQL" is listed is fine to add; skip if alias already listed)
      const target = opts.appendToLast ? data.skills[data.skills.length - 1] : bestGroupFor(data.skills, a.skill);
      const surface = a.skill; // canonical name reads best in a skills list
      const confirmed = facts.confirmed.has(a.skill) && !facts.skills.get(a.skill)?.some((e) => !e.startsWith('Confirmed'));
      changes.push({
        id: cid('skadd'),
        kind: 'skill_added',
        section: 'skills',
        target: { skillGroupId: target.id, skill: a.skill },
        before: null,
        after: surface,
        provenance: confirmed ? 'user_confirmed' : a.via ? 'inference' : 'fact',
        evidence: a.evidence.slice(0, 3),
        reason: a.via
          ? `The job asks for ${a.skill}; your resume shows ${a.via}, which implies it.`
          : `The job asks for ${a.skill} and your resume already shows it, but it isn't in your Skills section.`,
        accepted: true,
        informational: false,
        blocked: null,
        hasPlaceholder: false,
        edited: false,
        source: 'heuristic',
      });
      inSection.add(a.skill);
    }
  }

  // Report job skills we will NOT add.
  for (const a of match.skills) {
    if (a.status === 'matched') continue;
    const reason =
      a.status === 'transferable'
        ? `Not found in your resume. You have related experience (${a.via}) — mention ${a.skill} only if you have actually used it.`
        : a.status === 'partial'
          ? `Your resume shows ${a.via}, but not ${a.skill} specifically. Add it only if you have used it.`
          : 'Not found in your resume or profile.';
    changes.push({
      id: cid('sknot'),
      kind: 'skill_not_added',
      section: 'skills',
      target: { skill: a.skill },
      before: null,
      after: null,
      provenance: 'missing',
      evidence: a.evidence,
      reason,
      accepted: false,
      informational: true,
      blocked: null,
      hasPlaceholder: false,
      edited: false,
      source: 'heuristic',
    });
  }
  return changes;
}

function bestGroupFor(groups: SkillGroup[], skill: string): SkillGroup {
  const cat = getSkill(skill)?.cat;
  let best = groups[0];
  let bestScore = -1;
  for (const g of groups) {
    const cats = g.items.map((i) => getSkill(canonOf(i) ?? '')?.cat);
    let score = cats.filter((c) => c === cat).length;
    const label = (g.category ?? '').toLowerCase();
    if (cat === 'language' && /language/.test(label)) score += 5;
    if ((cat === 'cloud' || cat === 'devops') && /cloud|devops|tools|infra/.test(label)) score += 3;
    if ((cat === 'frontend' || cat === 'backend') && /framework|librar|web/.test(label)) score += 3;
    if (cat === 'database' && /data|database|storage/.test(label)) score += 4;
    if (score > bestScore) {
      best = g;
      bestScore = score;
    }
  }
  return best;
}

// ------------------------------------------------------------------ bullets

const GERUND_TO_PAST: Record<string, string> = {
  building: 'Built', leading: 'Led', writing: 'Wrote', running: 'Ran', making: 'Made', setting: 'Set', owning: 'Owned', driving: 'Drove',
  bringing: 'Brought', teaching: 'Taught', keeping: 'Kept', choosing: 'Chose', overseeing: 'Oversaw', planning: 'Planned', shipping: 'Shipped',
  managing: 'Managed', creating: 'Created', handling: 'Handled', coordinating: 'Coordinated', analyzing: 'Analyzed', operating: 'Operated',
  automating: 'Automated', migrating: 'Migrated', integrating: 'Integrated', facilitating: 'Facilitated', scaling: 'Scaled', updating: 'Updated',
  configuring: 'Configured', executing: 'Executed', producing: 'Produced', reducing: 'Reduced', improving: 'Improved', providing: 'Provided',
  resolving: 'Resolved', defining: 'Defined', organizing: 'Organized', optimizing: 'Optimized', preparing: 'Prepared', delivering: 'Delivered',
  architecting: 'Architected', troubleshooting: 'Troubleshot', debugging: 'Debugged', mentoring: 'Mentored', training: 'Trained',
};

/** "maintaining" -> "Maintained". Returns null when unsure, so no awkward rewrite is produced. */
function gerundToPast(g: string): string | null {
  const w = g.toLowerCase();
  if (GERUND_TO_PAST[w]) return GERUND_TO_PAST[w];
  if (!w.endsWith('ing') || w.length < 7) return null;
  const stem = w.slice(0, -3);
  // Safe regular verbs: stems ending in two consonants or a vowel pair + consonant (maintain, develop->?, support, test, design)
  if (/(?:[aeiou]{2}[b-df-hj-np-tv-z]|[b-df-hj-np-tv-z]{2})$/.test(stem) && !/(ll|ss|ng|ck)$/.test(stem.slice(-2)) && !/([b-df-hj-np-tv-z])\1$/.test(stem)) {
    return capitalizeFirst(`${stem}ed`);
  }
  if (/(elop|isit|ffer|ock|ell)$/.test(stem)) return capitalizeFirst(`${stem}ed`);
  return null;
}

const GENERIC_OBJECTS = ['backend services', 'microservices', 'web services', 'services', 'APIs', 'web applications', 'applications', 'data pipelines', 'pipelines', 'dashboards', 'tools', 'internal tools', 'systems', 'features', 'scripts', 'integrations'];
const INJECTABLE_CATS = new Set(['language', 'backend', 'frontend', 'data', 'ml', 'mobile']);

interface Rewrite {
  text: string;
  reasons: string[];
  evidence: string[];
  inference: boolean;
}

/** Deterministic, evidence-preserving bullet rewrites. Returns null when nothing changes. */
export function rewriteBullet(bullet: Bullet, siblings: Bullet[], entryTech: string[], job: JobAnalysis, _facts?: FactBase): Rewrite | null {
  let text = bullet.text;
  const reasons: string[] = [];
  const evidence: string[] = [];
  let inference = false;

  // 1) Weak openers.
  const resp = text.match(/^(?:was\s+)?responsible for\s+(\w+ing)\b\s*/i);
  if (resp) {
    const past = gerundToPast(resp[1]);
    let rest = text.slice(resp[0].length);
    // Keep parallel structure: "maintaining X and writing Y" -> "Maintained X and wrote Y"
    let ok = !!past;
    rest = rest.replace(/(\band\s+|,\s*)(\w+ing)\b/g, (m, sep: string, g: string) => {
      const p = gerundToPast(g);
      if (!p) {
        ok = false;
        return m;
      }
      return sep + p.toLowerCase();
    });
    if (ok && past) {
      text = `${past} ${rest}`;
      reasons.push('Replaced "Responsible for" with a direct action verb');
    }
  } else {
    const weak = text.match(/^(worked on|helped (?:with|to)|assisted (?:with|in)|involved in|participated in|tasked with)\s+/i);
    if (weak) {
      text = 'Contributed to ' + text.slice(weak[0].length);
      reasons.push(`Replaced "${weak[1]}" with "Contributed to"`);
    }
  }

  // 2) Terminology alignment: use the job's wording for the same skill.
  for (const m of findSkills(text)) {
    // Only technical terms; soft-skill aliases are ordinary words ("collaborated").
    if (!TECH_CATEGORIES.includes(getSkill(m.name)?.cat ?? 'soft')) continue;
    const jdForm = job.surfaceForms[m.name];
    if (!jdForm || jdForm === m.surface || jdForm.length < 3 || jdForm.toLowerCase() === m.surface.toLowerCase()) continue;
    // Only swap to a form that is a known name of the same skill and not a longer phrase ("CI/CD" -> "CI/CD pipelines")
    const wordCount = (s: string) => s.trim().split(/\s+/).length;
    if (findSkills(jdForm)[0]?.name !== m.name || wordCount(jdForm) > wordCount(m.surface)) continue;
    if (![...job.requiredSkills, ...job.preferredSkills, ...job.technologies].includes(m.name)) continue;
    // Only swap for the canonical name or a clearly equivalent long form (avoid "Lambda" -> "AWS Lambda" duplications)
    if (text.includes(jdForm)) continue;
    text = text.replace(new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(m.surface)}(?![A-Za-z0-9])`), jdForm);
    reasons.push(`Used the job's term "${jdForm}" instead of "${m.surface}" (same skill)`);
  }

  // 3) Add same-role technology context to generic bullets (inference, shown for review).
  if (!findSkills(text).length) {
    const priority = jobPriority(job);
    const candidates = entryTech
      .filter((t) => priority.includes(t) && INJECTABLE_CATS.has(getSkill(t)?.cat ?? ''))
      .sort((a, b) => priority.indexOf(a) - priority.indexOf(b));
    const tech = candidates[0];
    if (tech) {
      for (const obj of GENERIC_OBJECTS) {
        const re = new RegExp(`^(\\w+(?:ed|t)\\s+(?:(?:and|&)\\s+\\w+(?:ed|t)\\s+)?)(${escapeRegExp(obj)})\\b`, 'i');
        const mm = text.match(re);
        if (mm) {
          const ev = siblings.find((s) => s.id !== bullet.id && findSkills(s.text).some((x) => x.name === tech));
          text = text.replace(re, `$1${job.surfaceForms[tech] && job.surfaceForms[tech].length > 2 ? job.surfaceForms[tech] : tech} $2`);
          reasons.push(`Named the technology (${tech}) used in this same role`);
          evidence.push(ev ? `Same role: "${ev.text}"` : `Listed technologies for this role include ${tech}`);
          inference = true;
          break;
        }
      }
    }
  }

  if (text === bullet.text) return null;
  return { text, reasons, evidence, inference };
}

function bulletRelevance(text: string, job: JobAnalysis, respTerms: Set<string>[]): number {
  const priority = jobPriority(job);
  let s = 0;
  for (const m of findSkills(text)) {
    if (priority.indexOf(m.name) < 0) continue;
    const tech = TECH_CATEGORIES.includes(getSkill(m.name)?.cat ?? 'soft');
    s += tech ? (job.requiredSkills.includes(m.name) ? 2 : 1) : 0.5;
  }
  const t = termSet(text);
  let best = 0;
  for (const r of respTerms) best = Math.max(best, containment(r, t));
  return s + best * 3 + (hasMetric(text) ? 0.5 : 0);
}

export function proposeBulletChanges(data: ResumeData, job: JobAnalysis, facts: FactBase): Change[] {
  const changes: Change[] = [];
  const respTerms = job.responsibilities.map((r) => termSet(r));
  const entries = [
    ...data.experience.map((e, idx) => ({ id: e.id, kind: 'experience' as const, label: [e.title, e.company].filter(Boolean).join(' @ '), bullets: e.bullets, tech: e.technologies, recent: idx < 2 })),
    ...data.projects.map((p) => ({ id: p.id, kind: 'projects' as const, label: `Project ${p.name}`, bullets: p.bullets, tech: p.technologies, recent: false })),
  ];
  const rewritten = new Map<string, string>();
  for (const e of entries) {
    const target = e.kind === 'experience' ? { experienceId: e.id } : { projectId: e.id };
    // rephrase
    for (const b of e.bullets) {
      const rw = rewriteBullet(b, e.bullets, e.tech, job, facts);
      if (!rw) continue;
      rewritten.set(b.id, rw.text);
      changes.push({
        id: cid('bul'),
        kind: 'bullet_rephrased',
        section: e.kind,
        target: { ...target, bulletId: b.id },
        before: b.text,
        after: rw.text,
        provenance: rw.inference ? 'inference' : 'fact',
        evidence: rw.evidence.length ? rw.evidence : [`Original: "${b.text}"`],
        reason: rw.reasons.join('; '),
        accepted: true,
        informational: false,
        blocked: null,
        hasPlaceholder: false,
        edited: false,
        source: 'heuristic',
      });
    }
    // reorder by relevance
    if (e.bullets.length > 1) {
      const scored = e.bullets.map((b, i) => ({ b, i, s: bulletRelevance(b.text, job, respTerms) }));
      const sorted = [...scored].sort((x, y) => (Math.abs(y.s - x.s) < 0.01 ? x.i - y.i : y.s - x.s));
      if (sorted.some((x, k) => x.i !== k)) {
        changes.push({
          id: cid('ord'),
          kind: 'bullets_reordered',
          section: e.kind,
          target: { ...target, order: sorted.map((x) => x.b.id) },
          before: e.bullets.map((b) => b.text),
          after: sorted.map((x) => x.b.text),
          provenance: 'fact',
          evidence: [`Most relevant first: "${sorted[0].b.text}"`],
          reason: `Bullets in ${e.label} reordered so the most job-relevant work appears first.`,
          accepted: true,
          informational: false,
          blocked: null,
          hasPlaceholder: false,
          edited: false,
          source: 'heuristic',
        });
      }
      // Metric suggestions for the most relevant bullets lacking numbers (recent roles only)
      if (e.recent) {
        for (const x of sorted.slice(0, 3).filter((x) => !hasMetric(x.b.text)).slice(0, 2)) {
          const base = (rewritten.get(x.b.id) ?? x.b.text).replace(/[.\s]+$/, '');
          changes.push({
            id: cid('sug'),
            kind: 'suggestion',
            section: e.kind,
            target: { ...target, bulletId: x.b.id },
            before: x.b.text,
            after: `${base}, [add measurable result, e.g. % faster or users served].`,
            provenance: 'suggestion',
            evidence: [],
            reason: 'Potential improvement: add a measurable impact if you have one. Replace the placeholder with a real number — never an estimate you can\'t back up.',
            accepted: false,
            informational: false,
            blocked: null,
            hasPlaceholder: true,
            edited: false,
            source: 'heuristic',
          });
        }
      }
    }
  }
  return changes;
}

// ------------------------------------------------------------------ summary

const SOFT_PHRASES: Record<string, string> = {
  Mentoring: 'mentoring engineers',
  'Code Review': 'code reviews',
  Collaboration: 'cross-functional collaboration',
  Agile: 'Agile delivery',
  Leadership: 'technical leadership',
};

export function proposeSummary(data: ResumeData, job: JobAnalysis, facts: FactBase): Change | null {
  const years = Math.floor(facts.months / 12);
  const title = data.experience[0]?.title || data.personal.headline || '';
  if (!title && !years) return null;
  const priority = jobPriority(job);
  const techs = priority
    .filter((s) => (facts.skills.has(s) || facts.implied.has(s)) && TECH_CATEGORIES.includes(getSkill(s)?.cat ?? 'soft'))
    .filter((s) => !['AWS Lambda', 'S3', 'EC2'].includes(s) || !priority.slice(0, priority.indexOf(s)).includes('AWS'))
    .slice(0, 4)
    .map((s) => (job.surfaceForms[s] && job.surfaceForms[s].length > 2 ? job.surfaceForms[s] : s));
  const lowerAll = facts.allText.toLowerCase();
  const areas = ['backend services', 'web applications', 'APIs', 'data pipelines', 'mobile apps', 'cloud infrastructure', 'distributed systems', 'frontend applications', 'machine learning models']
    .filter((a) => lowerAll.includes(a.toLowerCase()) || (a === 'APIs' && /\bapis?\b/.test(lowerAll)))
    .slice(0, 2);
  const evidence: string[] = [];
  let s1 = capitalizeFirst(title || 'Professional');
  if (years >= 1) {
    s1 += ` with ${years}+ years of experience`;
    evidence.push(`${years}+ years computed from your dated roles: ${data.experience.map((e) => e.dateText || `${e.startDate}–${e.endDate}`).join(', ')}`);
  }
  if (areas.length) s1 += ` building ${areas.join(' and ')}`;
  if (techs.length) {
    s1 += `${areas.length || years >= 1 ? '' : ''} using ${techs.length > 1 ? `${techs.slice(0, -1).join(', ')} and ${techs[techs.length - 1]}` : techs[0]}`;
    for (const t of techs) {
      const canon = findSkills(t)[0]?.name ?? t;
      const ev = facts.skills.get(canon)?.[0] ?? (facts.implied.get(canon) ? `Implied by ${facts.implied.get(canon)}` : '');
      if (ev) evidence.push(`${t}: ${ev}`);
    }
  }
  s1 += '.';
  const sentences = [s1];
  // Highlight: the most job-relevant bullet that has a real metric, quoted nearly verbatim.
  const respTerms = job.responsibilities.map((r) => termSet(r));
  const best = data.experience
    .flatMap((e) => e.bullets)
    .filter((b) => hasMetric(b.text))
    .map((b) => ({ b, s: bulletRelevance(b.text, job, respTerms) }))
    .sort((a, b) => b.s - a.s)[0];
  if (best) {
    const t = best.b.text.replace(/[.\s]+$/, '');
    sentences.push(`Recent impact: ${t.charAt(0).toLowerCase()}${t.slice(1)}.`);
    evidence.push(`Highlight copied from: "${best.b.text}"`);
  }
  const soft = Object.keys(SOFT_PHRASES).filter((k) => facts.skills.has(k) && (job.requiredSkills.includes(k) || job.preferredSkills.includes(k) || ['Mentoring', 'Collaboration'].includes(k)));
  if (soft.length) {
    const ph = soft.slice(0, 2).map((k) => SOFT_PHRASES[k]);
    sentences.push(`Experienced in ${ph.join(' and ')}.`);
    for (const k of soft.slice(0, 2)) evidence.push(`${k}: ${facts.skills.get(k)![0]}`);
  }
  const text = sentences.join(' ');
  const had = data.summary.text.trim();
  return {
    id: cid('sum'),
    kind: had ? 'summary_rephrased' : 'summary_generated',
    section: 'summary',
    target: {},
    before: had || null,
    after: text,
    provenance: 'fact',
    evidence,
    reason: had
      ? 'Summary rewritten for this job using only facts from your resume (title, computed years, matched skills, and an existing achievement).'
      : 'Added a job-specific summary built only from facts in your resume.',
    accepted: true,
    informational: false,
    blocked: null,
    hasPlaceholder: false,
    edited: false,
    source: 'heuristic',
  };
}
