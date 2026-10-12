import {
  AppError,
  ErrorCodes,
  type ResumeData,
  ResumeDataSchema,
  findDateRanges,
  formatYearMonth,
  parseSingleDate,
} from '@pingx969/shared';

/**
 * Accepts either this app's internal ResumeData JSON or the JSON Resume schema
 * (https://jsonresume.org/schema). Returns normalized ResumeData (line refs are assigned later
 * when the plain-text rendition is produced).
 */
export function importResumeJson(text: string): { data: ResumeData; flavor: 'internal' | 'jsonresume' } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError(ErrorCodes.CORRUPTED_FILE, 'The JSON file is not valid JSON.', 422);
  }
  if (!raw || typeof raw !== 'object') throw new AppError(ErrorCodes.UNSUPPORTED_FILE, 'The JSON file does not contain a resume object.', 422);
  const obj = raw as Record<string, unknown>;
  if ('basics' in obj || 'work' in obj) return { data: fromJsonResume(obj), flavor: 'jsonresume' };
  if ('personal' in obj || 'experience' in obj) {
    const withIds = assignIds(obj);
    const parsed = ResumeDataSchema.safeParse(withIds);
    if (!parsed.success) {
      throw new AppError(ErrorCodes.VALIDATION, 'The resume JSON does not match the expected structure.', 422, parsed.error.issues.slice(0, 5));
    }
    return { data: parsed.data, flavor: 'internal' };
  }
  throw new AppError(ErrorCodes.UNSUPPORTED_FILE, 'Unrecognized JSON resume format. Use JSON Resume or this app\'s export format.', 422);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}
function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]) : [];
}

function isoish(v: unknown): string {
  const s = str(v).trim();
  if (!s) return '';
  if (/^present$/i.test(s)) return 'present';
  const iso = s.match(/^(\d{4})(?:-(\d{2}))?/);
  if (iso) return iso[2] ? `${iso[1]}-${iso[2]}` : iso[1];
  const d = parseSingleDate(s);
  return d ? formatYearMonth(d) : '';
}

function assignIds(obj: Record<string, unknown>): Record<string, unknown> {
  const o = structuredClone(obj);
  const exp = arr(o.experience);
  exp.forEach((e, i) => {
    e.id ??= `exp-${i}`;
    arr(e.bullets).forEach((b, j) => {
      b.id ??= `exp-${i}-b${j}`;
      b.line ??= null;
    });
    if (Array.isArray(e.bullets) && e.bullets.every((b) => typeof b === 'string')) {
      e.bullets = (e.bullets as string[]).map((t, j) => ({ id: `exp-${i}-b${j}`, text: t, line: null }));
    }
  });
  arr(o.education).forEach((e, i) => (e.id ??= `edu-${i}`));
  if (Array.isArray(o.skills) && o.skills.every((s) => typeof s === 'string')) {
    o.skills = [{ id: 'sk-0', category: null, items: o.skills, line: null }];
  }
  arr(o.skills).forEach((g, i) => (g.id ??= `sk-${i}`));
  arr(o.projects).forEach((p, i) => {
    p.id ??= `proj-${i}`;
    if (Array.isArray(p.bullets) && p.bullets.every((b) => typeof b === 'string')) {
      p.bullets = (p.bullets as string[]).map((t, j) => ({ id: `proj-${i}-b${j}`, text: t, line: null }));
    }
  });
  arr(o.certifications).forEach((c, i) => (c.id ??= `cert-${i}`));
  arr(o.custom_sections).forEach((c, i) => (c.id ??= `cus-${i}`));
  o.personal ??= {};
  o.summary ??= {};
  if (typeof o.summary === 'string') o.summary = { text: o.summary, lines: [] };
  return o;
}

function fromJsonResume(o: Record<string, unknown>): ResumeData {
  const basics = (o.basics ?? {}) as Record<string, unknown>;
  const loc = (basics.location ?? {}) as Record<string, unknown>;
  const name = str(basics.name);
  const nameParts = name.split(/\s+/).filter(Boolean);
  const profiles = arr(basics.profiles);
  const links: ResumeData['links'] = [];
  if (basics.url) links.push({ kind: 'website', label: 'website', url: str(basics.url) });
  for (const p of profiles) {
    const network = str(p.network).toLowerCase();
    const url = str(p.url);
    if (!url) continue;
    links.push({
      kind: network.includes('linkedin') ? 'linkedin' : network.includes('github') ? 'github' : 'other',
      label: str(p.network),
      url,
    });
  }
  return ResumeDataSchema.parse({
    personal: {
      name,
      firstName: nameParts[0] ?? '',
      lastName: nameParts.length > 1 ? nameParts[nameParts.length - 1] : '',
      email: str(basics.email),
      phone: str(basics.phone),
      location: [str(loc.city), str(loc.region)].filter(Boolean).join(', '),
      headline: str(basics.label),
    },
    summary: { text: str(basics.summary), lines: [] },
    experience: arr(o.work).map((w, i) => ({
      id: `exp-${i}`,
      title: str(w.position),
      company: str(w.name ?? w.company),
      location: str(w.location),
      startDate: isoish(w.startDate),
      endDate: w.endDate ? isoish(w.endDate) : w.startDate ? 'present' : '',
      dateText: '',
      bullets: [
        ...(w.summary ? [str(w.summary)] : []),
        ...(Array.isArray(w.highlights) ? w.highlights.map(str) : []),
      ].map((t, j) => ({ id: `exp-${i}-b${j}`, text: t, line: null })),
    })),
    education: arr(o.education).map((e, i) => ({
      id: `edu-${i}`,
      institution: str(e.institution),
      degree: str(e.studyType),
      field: str(e.area),
      startDate: isoish(e.startDate),
      endDate: isoish(e.endDate),
      gpa: str(e.score),
      details: Array.isArray(e.courses) ? e.courses.map(str) : [],
    })),
    skills: arr(o.skills).map((s, i) => ({
      id: `sk-${i}`,
      category: str(s.name) || null,
      items: Array.isArray(s.keywords) && s.keywords.length ? s.keywords.map(str) : [str(s.name)],
    })),
    projects: arr(o.projects).map((p, i) => ({
      id: `proj-${i}`,
      name: str(p.name),
      description: str(p.description),
      url: str(p.url),
      bullets: (Array.isArray(p.highlights) ? p.highlights.map(str) : []).map((t, j) => ({ id: `proj-${i}-b${j}`, text: t, line: null })),
      technologies: Array.isArray(p.keywords) ? p.keywords.map(str) : [],
    })),
    certifications: arr(o.certificates).map((c, i) => ({ id: `cert-${i}`, name: str(c.name), issuer: str(c.issuer), date: str(c.date) })),
    links,
  });
}

export { findDateRanges };
