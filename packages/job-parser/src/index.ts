import {
  AppError,
  ErrorCodes,
  type JobAnalysis,
  JobAnalysisSchema,
  type JobInput,
  type Seniority,
  STOPWORDS,
  degreeLevel,
  findDomains,
  findSkills,
  getSkill,
  isTechnology,
  normalizeText,
  splitSentences,
  stem,
  tokenize,
} from '@pingx969/shared';

export { htmlToText, extractJobPostingFromHtml } from './html';

type SectionKind = 'responsibilities' | 'requirements' | 'preferred' | 'about' | 'benefits' | 'other';

const SECTION_PATTERNS: [SectionKind, RegExp][] = [
  ['about', /^about (the |this )?(role|position|job|opportunity|team)\b/i],
  ['preferred', /\b(nice[\s-]to[\s-]haves?|preferred( qualifications| skills| experience)?|bonus( points)?|pluses|it'?s a plus|desired|extra credit|good to have|ideally you|would be great|even better)\b/i],
  ['requirements', /\b(requirements|qualifications|(what|who) (we'?re|we are) looking for|what you('ll| will)? bring|who you are|must[\s-]haves?|minimum qualifications|basic qualifications|required (skills|experience)|you have|about you|skills (and|&) experience|you should have|what you need|you('ll| will) need|your (background|experience|profile|skills)|experience you('ll)? need|what it takes|ideal candidate)\b/i],
  ['responsibilities', /\b(responsibilities|what you('ll| will) (do|work on|own|build)|the role|your role|duties|in this role|day[\s-]to[\s-]day|key responsibilities|you will|what you'?ll be doing|the job|your impact|your mission|role overview)\b/i],
  ['benefits', /\b(benefits|perks|compensation|what we offer|why (join|work)|salary|pay range|equal opportunity|eeo)\b/i],
  ['about', /\b(about (us|the company|the team|[A-Z][\w&]+)|who we are|our (team|company|mission))\b/i],
];

const BULLET_PREFIX = /^[\s•●▪◦‣■➢►▸*·○◆✓➤\-–—]+\s*|^\d{1,2}[.)]\s+/;

function isHeadingLine(line: string): SectionKind | null {
  const t = line.trim().replace(/[:：]\s*$/, '');
  if (!t || t.split(/\s+/).length > 8 || /[.!?]$/.test(t) || BULLET_PREFIX.test(line.trim().slice(0, 2)) && line.trim().length > 40) return null;
  for (const [kind, re] of SECTION_PATTERNS) if (re.test(t)) return kind;
  return null;
}

const TITLE_WORDS = /\b(engineer|developer|programmer|architect|manager|director|lead|intern|analyst|scientist|designer|consultant|specialist|administrator|sre|devops|head of|vp|product owner|researcher|technician|recruiter)\b/i;

export function analyzeJob(input: JobInput | string): JobAnalysis {
  const inp = typeof input === 'string' ? { text: input, url: '', title: '', company: '' } : input;
  const text = normalizeText(inp.text ?? '').length ? (inp.text ?? '').replace(/\r\n?/g, '\n') : '';
  if (text.replace(/\s/g, '').length < 20) {
    throw new AppError(ErrorCodes.EMPTY_JOB, 'Please paste a job description (it looks empty or too short to analyze).', 422);
  }
  const warnings: string[] = [];
  if (text.length < 300) warnings.push('This job description is short, so the analysis may miss requirements.');

  const rawLines = text.split('\n').map((l) => l.replace(/\s+$/, ''));
  const lines = rawLines.map((l) => l.trim()).filter(Boolean);

  // ---- sections
  const sectioned: { kind: SectionKind; text: string }[] = [];
  let current: SectionKind = 'other';
  for (const l of lines) {
    const h = isHeadingLine(l);
    if (h) {
      current = h;
      continue;
    }
    // Inline headings "Requirements: Python, AWS"
    const inline = l.match(/^([A-Za-z' ]{3,40}):\s+(.{3,})$/);
    if (inline) {
      const ih = isHeadingLine(inline[1]);
      if (ih) {
        sectioned.push({ kind: ih, text: inline[2] });
        continue;
      }
    }
    sectioned.push({ kind: current, text: l.replace(BULLET_PREFIX, '').trim() });
  }
  const hasSections = sectioned.some((s) => s.kind === 'requirements' || s.kind === 'responsibilities');

  const of = (k: SectionKind) => sectioned.filter((s) => s.kind === k).map((s) => s.text);
  let responsibilities = of('responsibilities');
  let requirements = of('requirements');
  let preferred = of('preferred');
  if (!hasSections) {
    // Classify sentences heuristically
    const sentences = splitSentences(sectioned.filter((s) => s.kind === 'other').map((s) => s.text).join('\n'));
    for (const s of sentences) {
      if (/\b(nice to have|is a plus|a bonus|preferred|bonus)\b/i.test(s)) preferred.push(s);
      else if (/\b(years|experience (with|in)|proficien|knowledge of|familiar|degree|understanding of|expertise)\b/i.test(s)) requirements.push(s);
      else if (/^(you('ll| will))?\s*(design|build|develop|own|lead|work|collaborate|create|maintain|drive|implement|write|partner|ship|improve|help|deploy|manage|operate|mentor|define)\b/i.test(s)) responsibilities.push(s);
    }
  }
  // Requirement bullets that say "... is a plus" are preferred
  const movePreferred = requirements.filter((r) => /\b(is a plus|a plus|nice to have|bonus|preferred|ideally)\b/i.test(r));
  requirements = requirements.filter((r) => !movePreferred.includes(r));
  preferred = [...preferred, ...movePreferred];
  responsibilities = responsibilities.filter((r) => r.length > 8);

  // ---- skills
  const reqSkills = new Set<string>();
  const prefSkills = new Set<string>();
  const surfaceForms: Record<string, string> = {};
  const alternatives: string[][] = [];
  const collect = (arr: string[], target: Set<string>) => {
    for (const line of arr) {
      const ms = findSkills(line);
      for (const m of ms) {
        target.add(m.name);
        surfaceForms[m.name] ??= m.surface;
      }
      // Alternatives: "X or Y", "X/Y", and lists like "Java, Python, Scala, or Node" (any one satisfies).
      if (ms.length >= 2 && /\bor\b|\//.test(line)) {
        let run: string[] = [ms[0].name];
        let hasOr = false;
        const flush = () => {
          if (hasOr && run.length >= 2) {
            const group = alternatives.find((g) => run.some((r) => g.includes(r)));
            if (group) for (const r of run) if (!group.includes(r)) group.push(r);
            if (!group) alternatives.push([...new Set(run)]);
          }
        };
        for (let i = 0; i < ms.length - 1; i++) {
          const between = line.slice(ms[i].index + ms[i].surface.length, ms[i + 1].index);
          if (/^\s*(\([^)]*\)\s*)?(,\s*)?(or|\/)\s*$/i.test(between)) {
            hasOr = true;
            run.push(ms[i + 1].name);
          } else if (/^\s*(\([^)]*\)\s*)?,\s*$/.test(between)) {
            run.push(ms[i + 1].name);
          } else {
            flush();
            run = [ms[i + 1].name];
            hasOr = false;
          }
        }
        flush();
      }
    }
  };
  collect(requirements, reqSkills);
  collect(responsibilities, reqSkills);
  collect(preferred, prefSkills);
  if (!reqSkills.size && !prefSkills.size) collect(lines, reqSkills);
  for (const s of reqSkills) prefSkills.delete(s);

  // ---- technologies with counts (anywhere in the JD)
  const technologyCounts: Record<string, number> = {};
  for (const m of findSkills(text)) {
    surfaceForms[m.name] ??= m.surface;
    if (isTechnology(m.name)) technologyCounts[m.name] = (technologyCounts[m.name] ?? 0) + 1;
  }
  const technologies = Object.keys(technologyCounts).sort((a, b) => technologyCounts[b] - technologyCounts[a]);

  // ---- title / company
  let title = inp.title?.trim() ?? '';
  let company = inp.company?.trim() ?? '';
  if (!title) {
    const labeled = text.match(/^(?:job title|position|role|title)\s*[:\-–]\s*(.+)$/im);
    if (labeled) title = labeled[1].trim();
    else {
      const first = lines.find((l) => TITLE_WORDS.test(l) && l.split(/\s+/).length <= 10 && !/[.!?]$/.test(l));
      if (first && lines.indexOf(first) < 4) title = first.replace(/\s*[|–—-]\s*(remote|hybrid|on-?site).*$/i, '').trim();
      else {
        const m = text.match(/(?:hiring|looking for|seeking)\s+(?:an?|our)\s+((?:[A-Z][\w+#./-]*\s){0,5}(?:Engineer|Developer|Manager|Designer|Scientist|Analyst|Architect|Lead))/);
        if (m) title = m[1].trim();
      }
    }
  }
  title = title.replace(/\s*[—–|]\s*.*$/, (m) => (TITLE_WORDS.test(m) ? m : '')).trim();
  if (!company) {
    const labeled = text.match(/^(?:company|employer|organization)\s*[:\-–]\s*(.+)$/im);
    if (labeled) company = labeled[1].trim();
    else {
      const titleIdx = lines.findIndex((l) => title && l.includes(title));
      const next = titleIdx >= 0 ? lines[titleIdx + 1] : undefined;
      const sep = next?.split(/\s+[—–|-]\s+|\s*\|\s*/);
      if (next && sep && sep.length >= 2 && /^[A-Z][\w&.' -]{1,40}$/.test(sep[0].trim()) && !TITLE_WORDS.test(sep[0])) company = sep[0].trim();
      if (!company) {
        const about = text.match(/\babout\s+([A-Z][\w&.'-]*(?:\s[A-Z][\w&.'-]*){0,3})\s*\n/);
        const is = text.match(/(?:^|\n|\.\s)([A-Z][\w&.'-]*(?:\s[A-Z][\w&.'-]*){0,3})\s+is\s+(?:building|a|an|the|on a mission|hiring|looking)\b/);
        const join = text.match(/\bjoin\s+([A-Z][\w&.'-]*(?:\s[A-Z][\w&.'-]*){0,2})(?=[\s,.!])/);
        const at = title ? text.match(new RegExp(`${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(?:at|@)\\s+([A-Z][\\w&.'-]*(?:\\s[A-Z][\\w&.'-]*){0,3})`)) : null;
        company = (at?.[1] ?? about?.[1] ?? is?.[1] ?? join?.[1] ?? '').trim();
        if (/^(us|our|the|we|you|a|an)$/i.test(company)) company = '';
      }
    }
  }

  // ---- years of experience
  let minYears: number | null = null;
  let maxYears: number | null = null;
  let yearsText = '';
  const yrRe = /(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*(\d{1,2})\s*)?\+?\s*(?:years?|yrs?)(?:'|’)?\s*(?:of\s+)?(?:[\w\s/-]{0,40}?)?(?:experience|exp\b|industry|professional|software|engineering|work)/gi;
  const yearSources = [...requirements, ...lines];
  for (const src of yearSources) {
    yrRe.lastIndex = 0;
    const m = yrRe.exec(src);
    if (m) {
      const a = Number(m[1]);
      if (a > 0 && a <= 25) {
        minYears = a;
        maxYears = m[2] ? Number(m[2]) : null;
        yearsText = m[0];
        break;
      }
    }
  }

  // ---- education
  const eduLines = lines.filter((l) => /\b(degree|bachelor|master|ph\.?d|b\.?s\.?|m\.?s\.?|bs\/ms|diploma|graduate of)\b/i.test(l));
  const eduText = eduLines.join(' ');
  const level = degreeLevel(eduText);
  const fields = Array.from(
    new Set(
      (eduText.match(/\b(computer science|computer engineering|software engineering|electrical engineering|engineering|mathematics|math|statistics|physics|information systems|information technology|data science|related (technical )?field|stem)\b/gi) ?? []).map((f) => f.toLowerCase()),
    ),
  );
  const eduPreferred = eduLines.length > 0 && eduLines.every((l) => preferred.includes(l.replace(BULLET_PREFIX, '').trim()) || /\b(preferred|a plus|nice to have)\b/i.test(l));

  // ---- seniority
  const seniority = inferSeniority(title, minYears);

  // ---- location / arrangement / type / salary
  const lower = text.toLowerCase();
  const workArrangement = /\bhybrid\b/.test(lower) ? 'hybrid' : /\b(fully remote|remote[- ]first|100% remote|remote\b)/.test(lower) && !/\bnot remote\b|\bno remote\b/.test(lower) ? 'remote' : /\b(on-?site|in[- ]office|in person)\b/.test(lower) ? 'onsite' : 'unknown';
  const locLabeled = text.match(/^(?:location|based in|office)\s*[:\-–]\s*(.+)$/im);
  const locInline = text.match(/\b([A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z.]+)?,\s*(?:[A-Z]{2}|[A-Z][a-z]+))(?=\s*(?:\(|\||$|\n|—|–|-|;))/m);
  const location = (locLabeled?.[1] ?? locInline?.[1] ?? (workArrangement === 'remote' ? 'Remote' : '')).trim();
  const employmentType = /\binternship\b|\bintern\b/i.test(title) ? 'Internship' : /\bcontract(or)?\b/.test(lower) ? 'Contract' : /\bpart[- ]time\b/.test(lower) ? 'Part-time' : /\bfull[- ]time\b/.test(lower) ? 'Full-time' : '';
  const salary = text.match(/[$€£]\s?\d[\d,.]*\s*[kK]?(?:\s*(?:-|–|to)\s*[$€£]?\s?\d[\d,.]*\s*[kK]?)?(?:\s*(?:per year|\/\s?yr|\/\s?year|annually|a year|per hour|\/\s?hr|\/\s?hour))?/)?.[0]?.trim() ?? '';

  const otherRequirements = lines
    .filter((l) => /\b(security clearance|clearance|travel|on-?call|visa sponsorship|sponsorship|relocat|background check|drug (test|screen)|citizenship|citizen|weekends?|shift work|driver'?s license|authorized to work)\b/i.test(l))
    .map((l) => l.replace(BULLET_PREFIX, '').trim())
    .slice(0, 8);

  // ---- keywords: technologies + repeated meaningful terms + domain phrases
  const domains = findDomains(text);
  const keywords = buildKeywords(text, [...reqSkills, ...prefSkills, ...technologies], surfaceForms, domains.flatMap((d) => d.terms), [company, title]);

  const qualifications = [...requirements];

  return JobAnalysisSchema.parse({
    title,
    company,
    seniority,
    requiredSkills: [...reqSkills],
    preferredSkills: [...prefSkills],
    responsibilities,
    qualifications,
    keywords,
    technologies,
    domains: domains.map((d) => d.name),
    education: {
      level,
      fields,
      required: level !== 'none' && !eduPreferred,
      equivalentExperienceOk: /\bor equivalent|equivalent (practical |professional |work )?experience|or related experience/i.test(eduText),
      text: eduLines.map((l) => l.replace(BULLET_PREFIX, '').trim()).join(' '),
    },
    yearsExperience: { min: minYears, max: maxYears, text: yearsText.trim() },
    location,
    workArrangement,
    employmentType,
    salary,
    otherRequirements,
    surfaceForms,
    skillAlternatives: alternatives,
    technologyCounts,
    warnings,
  });
}

export function inferSeniority(title: string, years: number | null): Seniority {
  const t = title.toLowerCase();
  if (/\bintern(ship)?\b|\bco-?op\b/.test(t)) return 'intern';
  if (/\b(director|vp|vice president|head of)\b/.test(t)) return 'director';
  if (/\b(engineering manager|manager)\b/.test(t)) return 'manager';
  if (/\bprincipal\b|\bdistinguished\b/.test(t)) return 'principal';
  if (/\bstaff\b/.test(t)) return 'staff';
  if (/\b(lead|tech lead)\b/.test(t)) return 'lead';
  if (/\b(senior|sr\.?)\b/.test(t) || /\b(iii|3)\b/.test(t)) return 'senior';
  if (/\b(junior|jr\.?|entry[- ]level|new grad|graduate|associate)\b/.test(t) || /\b(i|1)\b$/.test(t)) return 'junior';
  if (/\b(mid[- ]level|intermediate|ii|2)\b/.test(t)) return 'mid';
  if (years !== null) {
    if (years >= 8) return 'staff';
    if (years >= 5) return 'senior';
    if (years >= 2) return 'mid';
    return 'junior';
  }
  return title ? 'mid' : 'unknown';
}

function buildKeywords(text: string, skills: string[], surface: Record<string, string>, domainTerms: string[], exclude: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const addKw = (k: string) => {
    const key = k.toLowerCase().split(' ').map(stem).join(' ');
    if (!seen.has(key) && k.length > 1) {
      seen.add(key);
      out.push(k);
    }
  };
  for (const s of skills) {
    const e = getSkill(s);
    if (e && e.cat !== 'soft') addKw(surface[s] ?? s);
  }
  for (const d of domainTerms) addKw(d);
  // Repeated bigrams of content words (e.g. "payment processing", "event streaming")
  const toks = tokenize(text);
  const counts = new Map<string, { n: number; form: string }>();
  for (let i = 0; i < toks.length - 1; i++) {
    const a = toks[i];
    const b = toks[i + 1];
    if (STOPWORDS.has(a) || STOPWORDS.has(b) || /^\d/.test(a) || /^\d/.test(b) || a.length < 3 || b.length < 3) continue;
    const key = `${stem(a)} ${stem(b)}`;
    const cur = counts.get(key) ?? { n: 0, form: `${a} ${b}` };
    cur.n++;
    counts.set(key, cur);
  }
  const GENERIC = /\b(years experience|team members|equal opportunity|strong understanding|experience working|work closely|best practices|fast paced|full time|related field)\b/;
  // Bigrams naming the company or the job title itself are not useful resume keywords.
  const excluded = new Set(tokenize(exclude.join(' ')).map(stem));
  [...counts.values()]
    .filter((c) => c.n >= 2 && !GENERIC.test(c.form) && !c.form.split(' ').some((w) => excluded.has(stem(w))))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8)
    .forEach((c) => addKw(c.form));
  return out.slice(0, 30);
}
