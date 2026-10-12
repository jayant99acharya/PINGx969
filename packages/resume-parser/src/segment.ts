import {
  DEGREE_RE,
  type Education,
  type Experience,
  type Heading,
  type Project,
  type ResumeData,
  type ResumeDocument,
  type ResumeLink,
  type SectionKey,
  type SkillGroup,
  canonicalSkill,
  findDateRanges,
  findSkills,
  formatYearMonth,
  normalizeWhitespace,
  parseSingleDate,
  SINGLE_DATE_RE,
} from '@pingx969/shared';
import { cleanLineText } from './extract-text';
import { mode } from './extract-docx';

/** Section heading dictionary (normalized lowercase text -> section). */
const HEADINGS: Record<string, SectionKey> = {};
const add = (section: SectionKey, ...names: string[]) => names.forEach((n) => (HEADINGS[n] = section));
add('summary', 'summary', 'professional summary', 'profile', 'professional profile', 'about', 'about me', 'objective', 'career objective', 'career summary', 'overview', 'executive summary', 'qualifications summary', 'summary of qualifications', 'personal statement', 'introduction', 'highlights');
add('experience', 'experience', 'work experience', 'professional experience', 'employment', 'employment history', 'work history', 'career history', 'relevant experience', 'professional background', 'industry experience', 'experience highlights', 'professional history', 'technical experience', 'engineering experience', 'work', 'internships', 'internship experience');
add('education', 'education', 'academic background', 'education and training', 'academic qualifications', 'education and certifications', 'academics', 'educational background', 'academic history');
add('skills', 'skills', 'technical skills', 'core competencies', 'competencies', 'technologies', 'tech stack', 'skills and tools', 'tools', 'key skills', 'areas of expertise', 'expertise', 'skills and abilities', 'technical proficiencies', 'languages and technologies', 'skills and technologies', 'technical expertise', 'tools and technologies', 'core skills', 'skill set', 'skillset', 'proficiencies', 'technical summary', 'technical competencies');
add('projects', 'projects', 'personal projects', 'selected projects', 'key projects', 'side projects', 'open source', 'open source contributions', 'academic projects', 'notable projects', 'project experience', 'portfolio');
add('certifications', 'certifications', 'certificates', 'licenses', 'licenses and certifications', 'certifications and licenses', 'credentials', 'certification', 'professional certifications', 'courses and certifications', 'training and certifications');
add('header', 'contact', 'contact information', 'contact info', 'contact details', 'personal details', 'personal information');
const CUSTOM_HEADINGS = new Set(['awards', 'honors', 'honors and awards', 'awards and honors', 'publications', 'volunteer', 'volunteering', 'volunteer experience', 'leadership', 'leadership and activities', 'activities', 'interests', 'hobbies', 'languages', 'references', 'patents', 'achievements', 'accomplishments', 'speaking', 'talks', 'affiliations', 'memberships', 'coursework', 'relevant coursework', 'research', 'research experience', 'additional information', 'additional', 'extracurricular activities', 'military service']);

const TITLE_RE =
  /\b(engineer|engineering|developer|programmer|architect|manager|director|lead|intern|internship|analyst|scientist|designer|consultant|specialist|administrator|coordinator|associate|officer|head|vp|vice president|president|founder|co-founder|cto|ceo|cfo|coo|technician|researcher|assistant|sde|swe|representative|owner|contractor|freelancer|freelance|fellow|principal|staff|senior|junior|sr\.?|jr\.?|tutor|instructor|professor|strategist|recruiter|accountant|editor|writer|advisor|apprentice|trainee)\b/i;
const COMPANY_RE = /\b(inc|llc|ltd|corp|corporation|company|co\.|technologies|technology|labs|systems|group|solutions|software|bank|partners|studios|ventures|gmbh|plc|holdings|networks|health|financial|capital|media|games|global|international|agency)\b|\.(com|io|ai)\b/i;
const US_STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC ON BC QC AB'.split(' '));
/** States/provinces outside the US that commonly follow a city name. */
const REGIONS = new Set(
  [
    'andhra pradesh', 'assam', 'bihar', 'chhattisgarh', 'delhi', 'new delhi', 'goa', 'gujarat', 'haryana', 'himachal pradesh', 'jammu and kashmir', 'jharkhand', 'karnataka', 'kerala',
    'madhya pradesh', 'maharashtra', 'odisha', 'punjab', 'rajasthan', 'tamil nadu', 'telangana', 'uttar pradesh', 'uttarakhand', 'west bengal', 'chandigarh', 'karnātaka',
    'ontario', 'quebec', 'british columbia', 'alberta', 'manitoba', 'nova scotia', 'new south wales', 'victoria', 'queensland', 'western australia',
    'scotland', 'wales', 'bavaria', 'berlin', 'ile-de-france', 'catalonia', 'north holland',
  ],
);
const COUNTRIES = /^(usa|us|united states|canada|uk|united kingdom|england|germany|france|india|ireland|netherlands|spain|portugal|italy|poland|sweden|norway|denmark|finland|switzerland|austria|australia|new zealand|singapore|japan|china|brazil|mexico|israel|uae|remote)$/i;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b|\+\d{1,3}(?:[\s.-]?\d{2,5}){2,5}/;
const URL_RE = /\b(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9-]+\.)+(?:com|io|dev|me|net|org|ai|co|app|xyz|tech|page|site|so|in|us|uk|ca|de)(?:\/[^\s|,;)]*)?/gi;

export function headingSection(text: string): { section: SectionKey; custom: boolean } | null {
  const n = text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!n || n.length > 45) return null;
  if (HEADINGS[n]) return { section: HEADINGS[n], custom: false };
  if (CUSTOM_HEADINGS.has(n)) return { section: 'custom', custom: true };
  return null;
}

interface Ctx {
  doc: ResumeDocument;
  texts: string[]; // cleaned text per line
  bodySize: number;
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const isAllCaps = (s: string) => /[A-Z]/.test(s) && s === s.toUpperCase() && /[A-Z]{2}/.test(s);

function looksLikeHeadingStyle(ctx: Ctx, i: number): boolean {
  const l = ctx.doc.lines[i];
  const t = ctx.texts[i];
  if (!t || l.bullet || t.length > 40 || words(t) > 5 || /[@|]|\d{3}/.test(t) || /[.,;]$/.test(t)) return false;
  if (findDateRanges(t).length) return false;
  return l.headingStyle || (l.bold && isAllCaps(t)) || ((l.fontSize ?? 0) > ctx.bodySize + 1.2 && l.bold) || (isAllCaps(t) && words(t) <= 3 && l.ruleBelow);
}

export function segmentResume(doc: ResumeDocument): { data: ResumeData; warnings: string[] } {
  const warnings: string[] = [];
  const texts = doc.lines.map((l) => normalizeWhitespace(cleanLineText(l, doc.format)).replace(/\s*\t\s*/g, '\t'));
  // keep tabs as column separators but normalize other whitespace
  doc.lines.forEach((l, i) => {
    if (l.text.includes('\t')) texts[i] = cleanLineText(l, doc.format).replace(/[ \u00a0]+/g, ' ').replace(/ ?\t+ ?/g, '\t').trim();
  });
  const bodySize = mode(doc.lines.filter((l, i) => texts[i]).map((l) => l.fontSize ?? 0)) ?? 10;
  const ctx: Ctx = { doc, texts, bodySize };

  // 1) headings
  type H = { line: number; section: SectionKey; title: string; inline?: string };
  const headings: H[] = [];
  const knownSignatures: string[] = [];
  const signature = (i: number) => {
    const l = doc.lines[i];
    return `${l.bold}|${Math.round(l.fontSize ?? 0)}|${isAllCaps(texts[i])}|${l.headingStyle}`;
  };
  texts.forEach((t, i) => {
    if (!t || doc.lines[i].bullet) return;
    const stripped = t.replace(/[:\s]+$/, '');
    const hs = headingSection(stripped);
    if (hs && words(stripped) <= 6) {
      headings.push({ line: i, section: hs.section, title: stripped });
      knownSignatures.push(signature(i));
      return;
    }
    // Inline heading, e.g. "Skills: Python, Go, AWS"
    const inline = t.match(/^([A-Za-z &/]{3,40}):\s*(.+)$/);
    if (inline) {
      const ih = headingSection(inline[1]);
      if (ih && (ih.section === 'skills' || ih.section === 'summary')) {
        headings.push({ line: i, section: ih.section, title: inline[1], inline: inline[2] });
      }
    }
  });
  const headingSig = mode(knownSignatures);
  // 2) style-based custom headings that share the document's heading style
  texts.forEach((t, i) => {
    if (headings.some((h) => h.line === i)) return;
    if (!looksLikeHeadingStyle(ctx, i)) return;
    const firstHeading = headings.length ? Math.min(...headings.map((h) => h.line)) : Infinity;
    if (i < firstHeading && headings.length) return; // header area (name/title)
    if (headingSig && signature(i) !== headingSig) return;
    if (!headingSig && i < 3) return;
    headings.push({ line: i, section: 'custom', title: t.replace(/[:\s]+$/, '') });
  });
  headings.sort((a, b) => a.line - b.line);

  if (!headings.length) warnings.push('No standard section headings (Experience, Education, Skills) were found.');

  const firstHeadingLine = headings.length ? headings[0].line : Math.min(texts.length, 4);
  const sectionLines = (h: number): number[] => {
    const start = headings[h].line + 1;
    const end = h + 1 < headings.length ? headings[h + 1].line : texts.length;
    const out: number[] = [];
    for (let i = start; i < end; i++) out.push(i);
    return out;
  };

  const data: ResumeData = {
    personal: { name: '', firstName: '', lastName: '', email: '', phone: '', location: '', headline: '', nameLine: null, contactLines: [] },
    summary: { text: '', lines: [] },
    experience: [],
    education: [],
    skills: [],
    projects: [],
    certifications: [],
    links: [],
    custom_sections: [],
    headings: [],
  };

  // 3) header
  const headerIdx: number[] = [];
  for (let i = 0; i < firstHeadingLine; i++) if (texts[i]) headerIdx.push(i);
  parseHeader(ctx, headerIdx, data);
  if (!headings.length && texts.length > firstHeadingLine) {
    data.custom_sections.push({
      id: 'cus-0',
      title: 'Content',
      lines: texts.map((t, i) => ({ text: t, line: i })).slice(firstHeadingLine).filter((x) => x.text),
    });
  }

  // 4) sections
  let customCount = 0;
  headings.forEach((h, hi) => {
    const idx = sectionLines(hi).filter((i) => texts[i]);
    const heading: Heading = { section: h.section, customId: null, text: h.title, line: h.line };
    switch (h.section) {
      case 'summary': {
        const parts = idx.map((i) => texts[i]);
        if (h.inline) parts.unshift(h.inline);
        if (data.summary.text) data.summary.text += ' ';
        data.summary.text += parts.join(' ').trim();
        data.summary.lines.push(...(h.inline ? [h.line] : []), ...idx);
        break;
      }
      case 'experience':
        data.experience.push(...parseEntries(ctx, idx, data.experience.length));
        break;
      case 'education':
        data.education.push(...parseEducation(ctx, idx, data.education.length));
        break;
      case 'skills': {
        const groups = parseSkills(ctx, idx, data.skills.length);
        if (h.inline) groups.unshift(skillGroupFrom(h.inline, h.line, `sk-${data.skills.length + groups.length}`, null));
        data.skills.push(...groups);
        break;
      }
      case 'projects':
        data.projects.push(...parseProjects(ctx, idx, data.projects.length));
        break;
      case 'certifications':
        for (const i of idx) {
          const t = texts[i];
          // Prefer explicit separators; dashes are often part of the name ("Developer – Associate").
          let parts = t.split(/\s*(?:\||\t)\s*/).filter(Boolean);
          if (parts.length === 1) parts = t.split(/,\s+(?=(?:19|20)\d{2})|\s+[—-]\s+(?=[A-Z][\w ]*(?:,|$))/).filter(Boolean);
          const dm = t.match(SINGLE_DATE_RE);
          data.certifications.push({
            id: `cert-${data.certifications.length}`,
            name: parts[0] ?? t,
            issuer: parts.length > 1 && !SINGLE_DATE_RE.test(parts[1]) ? parts[1] : '',
            date: dm ? dm[0] : '',
            line: i,
          });
          SINGLE_DATE_RE.lastIndex = 0;
        }
        break;
      case 'header':
        // "Contact" / "Personal details" sections (common in sidebar layouts)
        parseContactLines(ctx, idx, data);
        break;
      default: {
        const id = `cus-${customCount++}`;
        heading.customId = id;
        data.custom_sections.push({ id, title: h.title, lines: idx.map((i) => ({ text: texts[i], line: i })) });
      }
    }
    data.headings.push(heading);
  });

  // Fallback: contact details placed somewhere unusual (footer, sidebar without a heading).
  if (!data.personal.email || !data.personal.phone) {
    const all = texts.map((_, i) => i).filter((i) => texts[i] && !data.personal.contactLines.includes(i));
    for (const i of all) {
      if (!data.personal.email && EMAIL_RE.test(texts[i])) {
        data.personal.email = texts[i].match(EMAIL_RE)![0];
        data.personal.contactLines.push(i);
      }
      const phone = texts[i].replace(EMAIL_RE, '').match(PHONE_RE);
      if (!data.personal.phone && phone && /[()\s.+-]/.test(phone[0]) && !findDateRanges(texts[i]).length) {
        data.personal.phone = phone[0].trim();
        if (!data.personal.contactLines.includes(i)) data.personal.contactLines.push(i);
      }
    }
  }

  // 5) links anywhere (header first)
  collectLinks(texts, data);
  if (!data.personal.email) warnings.push('No email address was found in the resume.');
  if (!data.experience.length) warnings.push('No work experience entries were detected.');
  return { data, warnings };
}

function parseHeader(ctx: Ctx, idx: number[], data: ResumeData) {
  const { texts, doc } = ctx;
  // Name: largest font among the first lines, else the first short alphabetic line.
  const candidates = idx.slice(0, 4).filter((i) => {
    const t = texts[i];
    return t && !EMAIL_RE.test(t) && !PHONE_RE.test(t) && words(t) <= 5 && /^[\p{L} .'-]+$/u.test(t);
  });
  let nameIdx = candidates[0];
  const sized = candidates.filter((i) => doc.lines[i].fontSize);
  if (sized.length > 1) nameIdx = sized.reduce((a, b) => ((doc.lines[b].fontSize ?? 0) > (doc.lines[a].fontSize ?? 0) ? b : a));
  if (nameIdx !== undefined) {
    const name = texts[nameIdx].replace(/\s+/g, ' ').trim();
    const pretty = isAllCaps(name) ? name.replace(/\b(\p{L})(\p{L}*)/gu, (_m, a: string, b: string) => a + b.toLowerCase()) : name;
    data.personal.name = pretty;
    const parts = pretty.split(' ').filter((p) => !/^[A-Z]\.?$/.test(p) || pretty.split(' ').length <= 2);
    data.personal.firstName = parts[0] ?? '';
    data.personal.lastName = parts.length > 1 ? parts[parts.length - 1] : '';
    data.personal.nameLine = nameIdx;
  }
  parseContactLines(ctx, idx.filter((i) => i !== nameIdx), data, true);
}

/** Email, phone, links and location from contact lines; in the top header, other short lines are the headline. */
function parseContactLines(ctx: Ctx, idx: number[], data: ResumeData, isTopHeader = false) {
  const { texts } = ctx;
  for (const i of idx) {
    const t = texts[i];
    if (!t) continue;
    let isContact = false;
    const email = t.match(EMAIL_RE);
    if (email && !data.personal.email) {
      data.personal.email = email[0];
      isContact = true;
    }
    const phone = t.replace(EMAIL_RE, '').match(PHONE_RE);
    if (phone && !data.personal.phone) {
      data.personal.phone = phone[0].trim();
      isContact = true;
    }
    if (URL_RE.test(t.replace(EMAIL_RE, ''))) isContact = true;
    URL_RE.lastIndex = 0;
    for (const seg of t.split(/\s*(?:\||•|·|\t|;|\s{2,}|,(?=\s*\S+@))\s*/)) {
      if (!data.personal.location && isLocation(seg) && !EMAIL_RE.test(seg)) {
        data.personal.location = seg.trim();
        isContact = true;
      }
    }
    if (isContact) data.personal.contactLines.push(i);
    else if (isTopHeader && !data.personal.headline && words(t) <= 12 && !/[.]$/.test(t)) data.personal.headline = t;
  }
}

export function isLocation(s: string): boolean {
  const t = s.trim().replace(/^\(|\)$/g, '');
  if (!t || t.length > 50 || /\d{3}|@|https?:|www\./.test(t)) return false;
  if (/^(remote|hybrid|on-?site)(\s*\(.*\))?$/i.test(t)) return true;
  const m = t.replace(/\s+\d{5}(-\d{4})?$/, '').match(/^(\p{Lu}[\p{L}.' -]*?),\s*([\p{L} .]+?)(?:,\s*([\p{L} .]+))?$/u);
  if (!m) return false;
  const isState = (x: string) => x.length === 2 && x === x.toUpperCase() && US_STATES.has(x);
  const region = m[2].trim();
  const country = m[3]?.trim();
  if (isState(region) || COUNTRIES.test(region) || REGIONS.has(region.toLowerCase())) return true; // "Austin, TX" / "Berlin, Germany" / "Pune, Maharashtra"
  return !!country && (COUNTRIES.test(country) || isState(country)); // "Toronto, Ontario, Canada"
}

function collectLinks(texts: string[], data: ResumeData) {
  const seen = new Set<string>();
  const contactFirst = [...data.personal.contactLines, ...texts.map((_, i) => i).filter((i) => !data.personal.contactLines.includes(i))];
  for (const i of contactFirst) {
    const t = texts[i].replace(new RegExp(EMAIL_RE.source, 'g'), ' ');
    const re = new RegExp(URL_RE.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      let url = m[0].replace(/[.)]+$/, '');
      if (/^\d/.test(url) || url.length < 6) continue;
      const key = url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
      if (seen.has(key)) continue;
      // Ignore bare tech names like "Node.js" or "Next.js"
      if (/^[a-z]+\.(js|io)$/i.test(key) && !/github|gitlab/i.test(key) && findSkills(url).length) continue;
      seen.add(key);
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      const kind: ResumeLink['kind'] = /linkedin\.com/i.test(url)
        ? 'linkedin'
        : /github\.com|gitlab\.com/i.test(url)
          ? 'github'
          : /behance|dribbble|portfolio/i.test(url)
            ? 'portfolio'
            : data.personal.contactLines.includes(i)
              ? 'website'
              : 'other';
      // Links outside the contact block (e.g. a project repo) are kept but never treated as profile links.
      const inContact = data.personal.contactLines.includes(i);
      data.links.push({ kind: inContact ? kind : 'other', label: kind === 'other' ? '' : kind, url });
    }
  }
}

// ---------------------------------------------------------------- experience

interface RawEntry {
  header: number[];
  bullets: number[];
  tech: number[];
}

function isDescriptionLine(t: string): boolean {
  if (findDateRanges(t).length) return false;
  const w = words(t);
  return w >= 10 || (/[.!]$/.test(t) && w >= 5);
}

function groupEntries(ctx: Ctx, idx: number[]): RawEntry[] {
  const entries: RawEntry[] = [];
  let cur: RawEntry | null = null;
  let curHasDate = false;
  for (const i of idx) {
    const l = ctx.doc.lines[i];
    const t = ctx.texts[i];
    if (!t) continue;
    if (/^(tech(nologies|nology)?( used)?|stack|tech stack|tools|environment|skills used)\s*:/i.test(t)) {
      (cur ??= { header: [], bullets: [], tech: [] }).tech.push(i);
      continue;
    }
    const hasDate = findDateRanges(t).length > 0;
    if (l.bullet || (cur && isDescriptionLine(t) && (cur.header.length > 0 || cur.bullets.length > 0))) {
      (cur ??= { header: [], bullets: [], tech: [] }).bullets.push(i);
      continue;
    }
    const startNew = !cur || cur.bullets.length > 0 || cur.tech.length > 0 || (hasDate && curHasDate) || cur.header.length >= 3;
    if (startNew) {
      cur = { header: [], bullets: [], tech: [] };
      entries.push(cur);
      curHasDate = false;
    }
    cur!.header.push(i);
    curHasDate ||= hasDate;
  }
  if (cur && !entries.includes(cur)) entries.push(cur);
  return entries;
}

const SPLIT_RE = /\t+|\s*\|\s*|\s+[•·]\s+|\s+[—–]\s+|\s+-\s+|\s{3,}|\s*,\s*(?=(?:19|20)\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(?:19|20)\d{2})/i;

export function parseEntryHeader(lines: string[]): {
  title: string;
  company: string;
  location: string;
  startDate: string;
  endDate: string;
  dateText: string;
} {
  let startDate = '';
  let endDate = '';
  let dateText = '';
  const parts: string[] = [];
  let location = '';
  for (const raw of lines) {
    let t = raw;
    const ranges = findDateRanges(t);
    if (ranges.length && !dateText) {
      const r = ranges[0];
      dateText = r.text.trim();
      startDate = formatYearMonth(r.start);
      endDate = formatYearMonth(r.end);
      t = t.replace(r.text, ' \t ');
    } else if (!dateText) {
      const single = t.match(new RegExp(`(?:^|[\\s|,(])(${SINGLE_DATE_RE.source})\\)?\\s*$`, 'i'));
      if (single) {
        const d = parseSingleDate(single[1]);
        if (d && d !== 'present') {
          dateText = single[1];
          startDate = formatYearMonth(d);
          endDate = startDate;
          t = t.slice(0, single.index) + ' \t ';
        }
      }
    }
    for (let p of t.split(SPLIT_RE)) {
      p = p.replace(/^[\s,–—-]+|[\s,–—-]+$/g, '').trim();
      // Strip only unbalanced parentheses left over from date removal: "(Jul 2024 - Present)".
      while (p.startsWith('(') && !p.includes(')')) p = p.slice(1).trim();
      while (p.endsWith(')') && (p.match(/\(/g)?.length ?? 0) < (p.match(/\)/g)?.length ?? 0)) p = p.slice(0, -1).trim();
      while (p.endsWith('(')) p = p.slice(0, -1).trim();
      if (!p) continue;
      // "Company, City, ST" -> peel off location
      if (!location) {
        const loc = p.match(/,\s*([\p{L} .'-]+,\s*[A-Z]{2}|Remote|[\p{L} .'-]+,\s*(?:USA|UK|Canada|India|Germany))$/u);
        if (loc && isLocation(loc[1])) {
          location = loc[1].trim();
          p = p.slice(0, loc.index).trim();
        } else if (isLocation(p)) {
          location = p;
          continue;
        }
      }
      const paren = p.match(/^(.*?)\s*\((remote|hybrid|on-?site|[\p{L} .'-]+,\s*[A-Z]{2})\)$/iu);
      if (paren && !location) {
        location = paren[2];
        p = paren[1];
      }
      parts.push(p);
    }
  }
  // "Software Engineer at Google" / "Software Engineer, Google"
  const expanded: string[] = [];
  for (const p of parts) {
    const at = p.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
    if (at && TITLE_RE.test(at[1])) expanded.push(at[1], at[2]);
    else {
      const comma = p.match(/^(.+?),\s+(.+)$/);
      if (comma && TITLE_RE.test(comma[1]) && !TITLE_RE.test(comma[2]) && parts.length === 1) expanded.push(comma[1], comma[2]);
      else expanded.push(p);
    }
  }
  let title = '';
  let company = '';
  // Title words dominate; company-ish words ("Software", "Labs") only break ties.
  const titleWords = (s: string) => s.match(new RegExp(TITLE_RE.source, 'gi'))?.length ?? 0;
  const score = (s: string) => (titleWords(s) ? titleWords(s) - (COMPANY_RE.test(s) ? 0.5 : 0) : 0);
  if (expanded.length === 1) {
    if (score(expanded[0]) > 0) title = expanded[0];
    else company = expanded[0];
  } else if (expanded.length > 1) {
    let best = 0;
    expanded.forEach((p, k) => {
      if (score(p) > score(expanded[best])) best = k;
    });
    if (score(expanded[best]) > 0) {
      title = expanded[best];
      company = expanded.find((_, k) => k !== best) ?? '';
    } else {
      company = expanded[0];
      title = expanded[1];
    }
  }
  return { title, company, location, startDate, endDate, dateText };
}

function techFrom(texts: string[]): string[] {
  const out: string[] = [];
  for (const m of findSkills(texts.join('\n'))) if (!out.includes(m.name)) out.push(m.name);
  return out;
}

function parseEntries(ctx: Ctx, idx: number[], offset: number): Experience[] {
  const out: Experience[] = [];
  for (const e of groupEntries(ctx, idx)) {
    const header = parseEntryHeader(e.header.map((i) => ctx.texts[i]));
    const n = offset + out.length;
    const prev = out[out.length - 1];
    // Multiple roles under one company: inherit the company.
    if (!header.company && prev && header.title && e.header.length === 1) header.company = prev.company;
    if (!header.title && !header.company && prev && !e.header.length) {
      // stray bullets: attach to previous entry
      prev.bullets.push(...e.bullets.map((i, k) => ({ id: `exp-${out.length - 1}-b${prev.bullets.length + k}`, text: ctx.texts[i], line: i })));
      continue;
    }
    const bulletTexts = e.bullets.map((i) => ctx.texts[i]);
    const techLines = e.tech.map((i) => ctx.texts[i].replace(/^[^:]+:\s*/, ''));
    out.push({
      id: `exp-${n}`,
      ...header,
      headerLines: e.header,
      bullets: e.bullets.map((i, k) => ({ id: `exp-${n}-b${k}`, text: ctx.texts[i], line: i })),
      technologies: techFrom([...bulletTexts, ...techLines, ...e.header.map((i) => ctx.texts[i])]),
    });
  }
  return out;
}

// ---------------------------------------------------------------- education

const INSTITUTION_RE = /\b(university|college|institute|school|academy|polytechnic|universit[éa]t?|iit|mit|bootcamp|conservatory)\b/i;

function parseEducation(ctx: Ctx, idx: number[], offset: number): Education[] {
  const groups: number[][] = [];
  let cur: number[] | null = null;
  let has = { inst: false, deg: false };
  for (const i of idx) {
    const t = ctx.texts[i];
    if (!t) continue;
    // Table header rows ("Course | Institute | Year of Passing | Result") carry no data.
    if (!/\d/.test(t) && (t.match(/\b(course|degree|qualification|institute|institution|university|school|college|year|result|score|grade|board|cgpa|gpa|percentage|marks)\b/gi)?.length ?? 0) >= 3) continue;
    // In table layouts every row (cells separated by tabs) is its own entry.
    const inst = (INSTITUTION_RE.test(t) || t.includes('\t')) && !ctx.doc.lines[i].bullet;
    const deg = DEGREE_RE.test(t) && !ctx.doc.lines[i].bullet;
    if (!cur || (inst && has.inst) || (deg && has.deg && !inst)) {
      cur = [];
      groups.push(cur);
      has = { inst: false, deg: false };
    }
    cur.push(i);
    has.inst ||= inst;
    has.deg ||= deg;
  }
  return groups.map((g, k) => {
    const texts = g.map((i) => ctx.texts[i]);
    const joined = texts.join(' | ');
    const degreeM = joined.match(DEGREE_RE);
    let degree = '';
    let field = '';
    if (degreeM) {
      degree = degreeM[0].replace(/\s+in$/, '').trim();
      const after = joined.slice((degreeM.index ?? 0) + degreeM[0].length);
      const fm = after.match(/^\s*(?:,|in|of|-|–|\s)\s*(?:in\s+)?([A-Z][\p{L}&/ ]{2,60}?)(?=\s*(?:$|,|\||\t|\s[-–—]\s|\(|\d|;|\.\s|GPA|Minor|Concentration))/u);
      if (fm && !INSTITUTION_RE.test(fm[1])) field = fm[1].trim();
    }
    let institution = '';
    for (const t of texts) {
      for (const p of t.split(SPLIT_RE)) {
        if (INSTITUTION_RE.test(p)) {
          institution = p.replace(/,\s*[\p{L} .'-]+,\s*[A-Z]{2}$/u, '').replace(/\s*\(.*\)$/, '').trim();
          break;
        }
      }
      if (institution) break;
    }
    // Table rows: "Degree (Field) <TAB> Institute <TAB> Year <TAB> Result"
    const cells = texts[0].split('\t').map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 2 && !INSTITUTION_RE.test(cells[0])) {
      const first = cells[0];
      if (!degree || first.startsWith(degree)) degree = first.replace(/\s*\([^)]*\)\s*$/, '');
      field ||= first.match(/\(([^)]+)\)\s*$/)?.[1] ?? '';
      institution ||= cells.find((c, n) => n > 0 && !/^\d|%$|cgpa|gpa/i.test(c)) ?? '';
    }
    if (institution && degree && institution.includes(degree)) institution = institution.replace(degree, '').replace(/^[\s,|-]+/, '').trim();
    const range = findDateRanges(joined)[0];
    let startDate = '';
    let endDate = '';
    let dateText = '';
    if (range) {
      startDate = formatYearMonth(range.start);
      endDate = formatYearMonth(range.end);
      dateText = range.text;
    } else {
      const single = joined.match(/(?:expected\s+|class of\s+|graduat\w*\s+)?((?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?(?:19|20)\d{2})/i);
      if (single) {
        const d = parseSingleDate(single[1]);
        if (d && d !== 'present') {
          endDate = formatYearMonth(d);
          dateText = single[0];
        }
      }
    }
    const gpa = joined.match(/\bGPA:?\s*([\d.]+(?:\s*\/\s*[\d.]+)?)/i)?.[1] ?? '';
    const details = g.filter((i) => ctx.doc.lines[i].bullet).map((i) => ctx.texts[i]);
    return {
      id: `edu-${offset + k}`,
      institution,
      degree,
      field,
      startDate,
      endDate,
      dateText,
      gpa,
      details,
      lines: g,
    };
  });
}

// ---------------------------------------------------------------- skills

function skillGroupFrom(t: string, line: number, id: string, category: string | null): SkillGroup {
  // Keep the author's delimiter style: "a, b", "a; b", "a | b", "a • b".
  const d = t.match(/[,;|•·]/)?.[0] ?? ',';
  const normalizedDelim = d === ',' ? ', ' : d === ';' ? '; ' : ` ${d} `;
  let items = t
    .split(/\s*[,;|•·]\s*(?![^(]*\))|\t+/)
    .map((s) => s.replace(/^and\s+/i, '').replace(/[.]$/, '').trim())
    .filter((s) => s && s.length <= 60);
  if (items.length === 1 && words(items[0]) > 6) {
    // A prose sentence: pull out recognizable skills instead.
    items = findSkills(t).map((m) => m.surface);
  }
  return { id, category, items, line, lines: [line], delimiter: normalizedDelim };
}

function parseSkills(ctx: Ctx, idx: number[], offset: number): SkillGroup[] {
  // Collect raw rows first: "Label: items", "Label<TAB>items" (table layouts), or plain lists.
  // A label-less line indented to the previous row's item column is a wrapped continuation.
  const rows: { category: string | null; text: string; lines: number[]; itemsX: number | null }[] = [];
  for (const i of idx) {
    const t = ctx.texts[i];
    if (!t) continue;
    const l = ctx.doc.lines[i];
    const prev = rows[rows.length - 1];
    const colon = t.match(/^([A-Za-z][A-Za-z &/+-]{1,40}):\s*(.+)$/);
    const tab = t.match(/^([A-Za-z][A-Za-z &/+()-]{1,40})\t+(.+)$/);
    if (colon || (tab && tab[1].trim().split(/\s+/).length <= 4 && !tab[1].includes(','))) {
      const m = (colon ?? tab)!;
      rows.push({ category: m[1].trim(), text: m[2], lines: [i], itemsX: l.tabX[0] ?? null });
      continue;
    }
    const continuation =
      prev &&
      ((prev.itemsX !== null && l.x !== null && Math.abs(l.x - prev.itemsX) < 6) ||
        (/,\s*$/.test(prev.text) && !/^[A-Z][A-Za-z &]{1,30}:/.test(t)));
    if (continuation) {
      prev.text = `${prev.text.replace(/\s+$/, '')} ${t.replace(/\t+/g, ' ')}`;
      prev.lines.push(i);
    } else rows.push({ category: null, text: t, lines: [i], itemsX: null });
  }
  return rows
    .map((r, k) => ({ ...skillGroupFrom(r.text, r.lines[0], `sk-${offset + k}`, r.category), lines: r.lines }))
    .filter((g) => g.items.length);
}

// ---------------------------------------------------------------- projects

function parseProjects(ctx: Ctx, idx: number[], offset: number): Project[] {
  const out: Project[] = [];
  for (const e of groupEntries(ctx, idx)) {
    const headerTexts = e.header.map((i) => ctx.texts[i]);
    const first = headerTexts[0] ?? '';
    const parts = first.split(SPLIT_RE).map((p) => p.trim()).filter(Boolean);
    const urlM = headerTexts.join(' ').match(URL_RE);
    URL_RE.lastIndex = 0;
    const range = findDateRanges(headerTexts.join(' '))[0];
    const paren = first.match(/\(([^)]+)\)/);
    const n = offset + out.length;
    const techLines = e.tech.map((i) => ctx.texts[i].replace(/^[^:]+:\s*/, ''));
    const bullets = e.bullets.map((i, k) => ({ id: `proj-${n}-b${k}`, text: ctx.texts[i], line: i }));
    const description = headerTexts.slice(1).filter((t) => isDescriptionLine(t)).join(' ');
    out.push({
      id: `proj-${n}`,
      name: (parts[0] ?? first).replace(/\s*\([^)]*\)\s*$/, '').trim(),
      description,
      url: urlM ? urlM[0] : '',
      dateText: range?.text ?? '',
      bullets,
      technologies: techFrom([...(paren ? [paren[1]] : []), ...techLines, ...headerTexts, ...bullets.map((b) => b.text)]),
      headerLines: e.header,
    });
  }
  return out;
}

export function canonicalSkillList(items: string[]): string[] {
  return items.map(canonicalSkill);
}
