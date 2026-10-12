import {
  type DegreeLevel,
  DEGREE_RANK,
  type ResumeData,
  canonicalSkill,
  degreeLevel,
  expandImplied,
  extractNumbers,
  findDomains,
  findSkills,
  flattenSkills,
  totalMonths,
} from '@pingx969/shared';

/**
 * Everything the candidate can truthfully claim, with evidence. The optimizer and the
 * fact guard only ever use what's in here.
 */
export interface FactBase {
  /** canonical skill -> evidence snippets ("Skills: Python, Go", "Northwind: Designed REST APIs in Python") */
  skills: Map<string, string[]>;
  /** canonical skills listed in the Skills section */
  skillsSection: Set<string>;
  /** implied skill -> skill that implies it (PostgreSQL -> SQL) */
  implied: Map<string, string>;
  /** user-confirmed skills (explicit confirmation in the app) */
  confirmed: Set<string>;
  numbers: Set<string>;
  months: number;
  highestDegree: DegreeLevel;
  degreeFields: string[];
  titles: string[];
  companies: string[];
  domains: Map<string, string[]>;
  allText: string;
  /** Lowercased words appearing anywhere in the source (for new-word checks). */
  vocabulary: Set<string>;
}

export function resumeText(data: ResumeData): string {
  const parts: string[] = [];
  parts.push(data.personal.headline, data.summary.text);
  for (const e of data.experience) parts.push(e.title, e.company, e.location, ...e.bullets.map((b) => b.text), e.technologies.join(', '));
  for (const e of data.education) parts.push(e.degree, e.field, e.institution, ...e.details);
  for (const g of data.skills) parts.push(`${g.category ?? ''} ${g.items.join(', ')}`);
  for (const p of data.projects) parts.push(p.name, p.description, ...p.bullets.map((b) => b.text), p.technologies.join(', '));
  for (const c of data.certifications) parts.push(c.name, c.issuer);
  for (const c of data.custom_sections) parts.push(c.title, ...c.lines.map((l) => l.text));
  return parts.filter(Boolean).join('\n');
}

export function buildFactBase(data: ResumeData, opts: { confirmedSkills?: string[]; yearsOverride?: number | null; now?: Date } = {}): FactBase {
  const skills = new Map<string, string[]>();
  const addEvidence = (skill: string, ev: string) => {
    const list = skills.get(skill) ?? [];
    if (list.length < 4 && !list.includes(ev)) list.push(ev);
    skills.set(skill, list);
  };
  const skillsSection = new Set<string>();
  for (const g of data.skills) {
    for (const item of g.items) {
      const found = findSkills(item);
      const names = found.length ? found.map((f) => f.name) : [canonicalSkill(item)];
      for (const n of names) {
        skillsSection.add(n);
        addEvidence(n, `Skills: ${g.category ? `${g.category}: ` : ''}${g.items.join(', ')}`);
      }
    }
  }
  for (const e of data.experience) {
    const label = [e.title, e.company].filter(Boolean).join(' @ ');
    for (const b of e.bullets) for (const m of findSkills(b.text)) addEvidence(m.name, `${label}: "${b.text}"`);
    for (const t of e.technologies) if (!skills.has(t)) addEvidence(t, `${label} (technologies)`);
  }
  for (const p of data.projects) {
    for (const b of [p.description, ...p.bullets.map((x) => x.text)]) for (const m of findSkills(b)) addEvidence(m.name, `Project ${p.name}: "${b}"`);
    for (const t of p.technologies) if (!skills.has(t)) addEvidence(t, `Project ${p.name} (technologies)`);
  }
  for (const m of findSkills(data.summary.text)) addEvidence(m.name, `Summary: "${data.summary.text.slice(0, 140)}"`);
  for (const c of data.certifications) for (const m of findSkills(c.name)) addEvidence(m.name, `Certification: ${c.name}`);
  for (const cs of data.custom_sections) for (const l of cs.lines) for (const m of findSkills(l.text)) addEvidence(m.name, `${cs.title}: "${l.text}"`);

  const confirmed = new Set<string>();
  for (const s of opts.confirmedSkills ?? []) {
    const c = canonicalSkill(s);
    confirmed.add(c);
    addEvidence(c, 'Confirmed by you in your profile');
  }
  const implied = expandImplied(skills.keys());
  const allText = resumeText(data);
  const numbers = new Set(extractNumbers(allText));
  const months =
    opts.yearsOverride != null
      ? Math.round(opts.yearsOverride * 12)
      : totalMonths(
          data.experience.map((e) => ({ start: e.startDate, end: e.endDate })),
          opts.now,
        );
  let highest: DegreeLevel = 'none';
  const fields: string[] = [];
  for (const e of data.education) {
    const lvl = degreeLevel(`${e.degree} ${e.field}`);
    if (DEGREE_RANK[lvl] > DEGREE_RANK[highest]) highest = lvl;
    if (e.field) fields.push(e.field.toLowerCase());
  }
  const domains = new Map<string, string[]>();
  for (const d of findDomains(allText)) domains.set(d.name, d.terms);
  const vocabulary = new Set(allText.toLowerCase().match(/[a-z0-9+#.]+/g) ?? []);
  return {
    skills,
    skillsSection,
    implied,
    confirmed,
    numbers,
    months,
    highestDegree: highest,
    degreeFields: fields,
    titles: data.experience.map((e) => e.title).filter(Boolean),
    companies: data.experience.map((e) => e.company).filter(Boolean),
    domains,
    allText,
    vocabulary,
  };
}

export function hasSkill(facts: FactBase, skill: string): boolean {
  return facts.skills.has(skill) || facts.implied.has(skill);
}

export { flattenSkills };
