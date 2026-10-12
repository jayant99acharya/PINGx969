import { type FieldType, STOPWORDS, conceptOf, normalizeText, tokenize } from '@pingx969/shared';

/**
 * Question normalization. Different sites phrase the same screening question differently
 * ("Are you legally authorized to work in the US?" vs "Do you currently have authorization
 * to work in the United States?"). We map each question to a stable `key`:
 *  - catalog keys (e.g. `work_authorization:US`) via concept rules, or
 *  - `custom:<signature>` for anything else, matched to saved answers by similarity.
 */
export interface QuestionMapping {
  key: string;
  normalized: string;
  category: string;
  confidence: number;
  sensitive: boolean;
  /** Answer depends on context (company, location) — always confirm with the user. */
  contextual: boolean;
  /** Field type this question corresponds to, when there is one. */
  fieldType: FieldType | null;
  answerKind: 'boolean' | 'text' | 'choice';
}

const COUNTRY_PATTERNS: [string, RegExp][] = [
  ['US', /\b(united states( of america)?|u\.?s\.?a?\.?|usa|america)\b/i],
  ['CA', /\bcanad(a|ian)\b/i],
  ['UK', /\b(united kingdom|u\.?k\.?|britain|great britain|england)\b/i],
  ['IN', /\bindia\b/i],
  ['DE', /\bgermany\b/i],
  ['AU', /\baustralia\b/i],
  ['IE', /\bireland\b/i],
  ['NL', /\bnetherlands\b/i],
  ['SG', /\bsingapore\b/i],
  ['EU', /\b(european union|eu)\b/i],
];

export const COUNTRY_NAMES: Record<string, string> = {
  US: 'the United States', CA: 'Canada', UK: 'the United Kingdom', IN: 'India', DE: 'Germany', AU: 'Australia', IE: 'Ireland', NL: 'the Netherlands', SG: 'Singapore', EU: 'the European Union',
};

export function detectCountry(text: string): string | null {
  // "US" in all caps only (avoid the pronoun "us")
  for (const [code, re] of COUNTRY_PATTERNS) {
    if (code === 'US') {
      if (/\b(united states( of america)?|usa|u\.s\.a?\.?|america)\b/i.test(text) || /\bUS\b/.test(text)) return 'US';
      continue;
    }
    if (re.test(text)) return code;
  }
  return null;
}

export function countryCode(name: string): string | null {
  if (!name) return null;
  if (/^(us|usa|united states.*|u\.s\.?a?\.?|america)$/i.test(name.trim())) return 'US';
  return detectCountry(name) ?? (name.trim().length === 2 ? name.trim().toUpperCase() : null);
}

export function cleanQuestion(raw: string): string {
  return normalizeText(raw)
    .replace(/\s*\*+\s*/g, ' ')
    .replace(/\((required|optional)\)/gi, '')
    .replace(/\s+[:：]\s*$/, '')
    .replace(/[:：]$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Rule {
  key: (t: string, country: string | null) => string;
  test: (t: string) => boolean;
  normalized: (country: string | null) => string;
  category: string;
  sensitive?: boolean;
  contextual?: boolean;
  fieldType?: FieldType;
  answerKind?: QuestionMapping['answerKind'];
}

const cc = (c: string | null) => c ?? 'ANY';
const where = (c: string | null) => (c ? ` in ${COUNTRY_NAMES[c] ?? c}` : '');

const RULES: Rule[] = [
  {
    // "authorized to work ... without sponsorship" is an authorization question, not a sponsorship one.
    test: (t) => /\b(authori[sz]ed|authori[sz]ation|eligible|eligibility|legally (permitted|able|allowed|entitled)|right to work|permitted to work|work permit|legal right)\b/i.test(t) && (!/\bsponsor/i.test(t) || /\bwithout (the )?(need (for|of) |requiring |requirement (for|of) )?(any )?(visa |employment )?sponsor/i.test(t)),
    key: (_t, c) => `work_authorization:${cc(c)}`,
    normalized: (c) => `Are you legally authorized to work${where(c)}?`,
    category: 'Work authorization',
    fieldType: 'workAuthorization',
    answerKind: 'boolean',
  },
  {
    test: (t) => /\bsponsor(ship|ed|ing)?\b|\bh-?1b\b|\bvisa (support|transfer)\b|\bimmigration (support|sponsorship)\b/i.test(t),
    key: (_t, c) => `sponsorship_required:${cc(c)}`,
    normalized: (c) => `Will you now or in the future require visa sponsorship to work${where(c)}?`,
    category: 'Work authorization',
    fieldType: 'sponsorship',
    answerKind: 'boolean',
  },
  {
    test: (t) => /\bcitizen(ship)?\b|\bnationality\b/i.test(t),
    key: (_t, c) => `citizenship:${cc(c)}`,
    normalized: (c) => (c ? `Are you a citizen of ${COUNTRY_NAMES[c] ?? c}?` : 'What is your citizenship?'),
    category: 'Work authorization',
    sensitive: true,
  },
  { test: (t) => /\bsecurity clearance|\bclearance\b/i.test(t), key: () => 'security_clearance', normalized: () => 'Do you hold an active security clearance?', category: 'Work authorization' },
  { test: (t) => /\brelocat/i.test(t), key: () => 'relocation', normalized: () => 'Are you willing to relocate?', category: 'Preferences', fieldType: 'relocation', answerKind: 'boolean', contextual: true },
  { test: (t) => /\b(salary|compensation|pay (expectation|range|requirement)|desired pay|expected (pay|ctc)|\bctc\b|rate expectation)/i.test(t), key: () => 'desired_salary', normalized: () => 'What are your salary expectations?', category: 'Preferences', fieldType: 'desiredSalary', answerKind: 'text', sensitive: true },
  { test: (t) => /\bnotice period\b|\bweeks'? notice\b/i.test(t), key: () => 'notice_period', normalized: () => 'What is your notice period?', category: 'Preferences', fieldType: 'noticePeriod', answerKind: 'text' },
  { test: (t) => /\b(start date|when can you start|earliest (possible )?(date|start)|available to start|availability to start|how soon can you)/i.test(t), key: () => 'start_date', normalized: () => 'When can you start?', category: 'Preferences', fieldType: 'startDate', answerKind: 'text' },
  { test: (t) => /\b(18 years|at least 18|over (the age of )?18|legal (working )?age|of legal age)/i.test(t), key: () => 'over_18', normalized: () => 'Are you at least 18 years old?', category: 'Eligibility', answerKind: 'boolean' },
  { test: (t) => /\bhow did you (hear|find|learn|come across)|\bwhere did you (hear|find|learn)|\breferral source|\bsource of (application|referral)/i.test(t), key: () => 'referral_source', normalized: () => 'How did you hear about this job?', category: 'Other', answerKind: 'choice', contextual: true },
  { test: (t) => /\b(were you referred|referred by|employee referral|know anyone (who works|at))/i.test(t), key: () => 'referred_by_employee', normalized: () => 'Were you referred by a current employee?', category: 'Other', answerKind: 'boolean', contextual: true },
  { test: (t) => /\b(previously|ever|formerly|before) (been )?(employed|worked|work)( (by|for|at|with))?\b|\bformer employee\b/i.test(t), key: () => 'previously_employed', normalized: () => 'Have you previously worked for this company?', category: 'Other', answerKind: 'boolean', contextual: true },
  { test: (t) => /\bnon-?compete|restrictive covenant|non-?solicit/i.test(t), key: () => 'non_compete', normalized: () => 'Are you subject to a non-compete or similar agreement?', category: 'Eligibility', answerKind: 'boolean' },
  { test: (t) => /\bbackground (check|screening)|\bcriminal|\bconvicted|\bfelony/i.test(t), key: () => 'background_check', normalized: () => 'Are you willing to undergo a background check?', category: 'Eligibility', answerKind: 'boolean', sensitive: true },
  { test: (t) => /\bdrug (test|screen)/i.test(t), key: () => 'drug_test', normalized: () => 'Are you willing to take a drug test?', category: 'Eligibility', answerKind: 'boolean' },
  { test: (t) => /\bwilling(ness)? to travel|\btravel (requirement|up to|\d+%)|\bable to travel/i.test(t), key: () => 'travel_ok', normalized: () => 'Are you willing to travel for work?', category: 'Preferences', answerKind: 'boolean' },
  { test: (t) => /\b(work|working) (on-?site|in (the |our )?office|in person)|\b(on-?site|in-office|hybrid)\b.*\b(able|willing|comfortable|ok)\b|\b(able|willing|comfortable)\b.*\b(on-?site|in-office|in office|hybrid|commute)/i.test(t), key: () => 'onsite_ok', normalized: () => 'Are you able to work on-site / hybrid at this location?', category: 'Preferences', answerKind: 'boolean', contextual: true },
  { test: (t) => /\b(remote|work from home|wfh)\b.*\b(prefer|preference)|\bwork arrangement/i.test(t), key: () => 'remote_preference', normalized: () => 'What is your preferred work arrangement?', category: 'Preferences', answerKind: 'choice' },
  { test: (t) => /\bpronoun/i.test(t), key: () => 'pronouns', normalized: () => 'What are your pronouns?', category: 'Personal', fieldType: 'pronouns', answerKind: 'text', sensitive: true },
  { test: (t) => /\bhispanic|\blatin[oax]/i.test(t), key: () => 'eeo_hispanic', normalized: () => 'Are you Hispanic or Latino?', category: 'Voluntary self-identification', fieldType: 'hispanicLatino', answerKind: 'choice', sensitive: true },
  { test: (t) => /\brace\b|\bethnicit|\bracial/i.test(t), key: () => 'eeo_race', normalized: () => 'What is your race/ethnicity?', category: 'Voluntary self-identification', fieldType: 'raceEthnicity', answerKind: 'choice', sensitive: true },
  { test: (t) => /\bgender\b|\bsex\b/i.test(t), key: () => 'eeo_gender', normalized: () => 'What is your gender?', category: 'Voluntary self-identification', fieldType: 'gender', answerKind: 'choice', sensitive: true },
  { test: (t) => /\bveteran|\bmilitary (service|status)|\barmed forces/i.test(t), key: () => 'eeo_veteran', normalized: () => 'What is your veteran status?', category: 'Voluntary self-identification', fieldType: 'veteranStatus', answerKind: 'choice', sensitive: true },
  { test: (t) => /\bdisabilit/i.test(t), key: () => 'eeo_disability', normalized: () => 'Do you have a disability?', category: 'Voluntary self-identification', fieldType: 'disabilityStatus', answerKind: 'choice', sensitive: true },
  { test: (t) => /\b(sms|text messages?)\b|\bconsent to (receive|be contacted)/i.test(t), key: () => 'contact_consent', normalized: () => 'Do you consent to being contacted by text message?', category: 'Other', answerKind: 'boolean' },
  { test: (t) => /\bhow many years\b|\byears of (professional |relevant |work )?experience\b|\btotal (work )?experience\b/i.test(t), key: (t) => `years_experience${yearsSubject(t)}`, normalized: () => 'How many years of experience do you have?', category: 'Experience', fieldType: 'yearsExperience', answerKind: 'text' },
];

/** Canonical phrasings of every catalog question (used to let an LLM pick a mapping). */
export const CANONICAL_QUESTIONS: string[] = [...new Set(RULES.flatMap((r) => [r.normalized('US'), r.normalized(null)]))];

function yearsSubject(t: string): string {
  const m = t.match(/\b(?:with|in|using|of)\s+([A-Za-z][\w+#.]*(?:\s[A-Za-z][\w+#.]*)?)\s*\??$/);
  if (!m || /experience|work|professional|relevant|total/i.test(m[1])) return '';
  return `:${m[1].toLowerCase().replace(/\s+/g, '-')}`;
}

/** Stemmed, synonym-mapped significant tokens used to compare custom questions. */
export function questionSignature(text: string): string[] {
  const toks = tokenize(text).filter((t) => !STOPWORDS.has(t) && !/^(please|describe|tell|briefly|explain|kindly|would|do|does|are|is|have|has)$/.test(t) && t.length > 1);
  return [...new Set(toks.map(conceptOf))].sort();
}

function hashSig(sig: string[]): string {
  let h = 2166136261;
  for (const c of sig.join(' ')) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function normalizeQuestion(raw: string): QuestionMapping {
  const text = cleanQuestion(raw);
  const country = detectCountry(text);
  for (const r of RULES) {
    if (!r.test(text)) continue;
    return {
      key: r.key(text, country),
      normalized: r.normalized(country),
      category: r.category,
      confidence: 0.95,
      sensitive: !!r.sensitive,
      contextual: !!r.contextual,
      fieldType: r.fieldType ?? null,
      answerKind: r.answerKind ?? 'text',
    };
  }
  const sig = questionSignature(text);
  return {
    key: `custom:${hashSig(sig)}`,
    normalized: text,
    category: 'Custom',
    confidence: sig.length ? 0.6 : 0.2,
    sensitive: false,
    contextual: false,
    fieldType: null,
    answerKind: 'text',
  };
}

/** Similarity of two questions (0..1): Dice coefficient over signatures. */
export function questionSimilarity(a: string, b: string): number {
  const sa = new Set(questionSignature(a));
  const sb = new Set(questionSignature(b));
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return (2 * inter) / (sa.size + sb.size);
}

export interface SavedAnswerLike {
  questionKey: string;
  rawQuestion: string;
  normalizedQuestion: string;
  answer: string;
  updatedAt?: string;
}

export interface AnswerLookup {
  answer: SavedAnswerLike;
  confidence: number;
  exact: boolean;
}

/**
 * Find the saved answer for a question: exact key first (catalog or identical custom
 * signature), then the most similar custom question. Below `minSimilarity` returns null —
 * we never guess.
 */
export function findSavedAnswer(question: string, saved: SavedAnswerLike[], minSimilarity = 0.72): AnswerLookup | null {
  const m = normalizeQuestion(question);
  const byKey = saved.filter((s) => s.questionKey === m.key).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  if (byKey.length) return { answer: byKey[0], confidence: m.key.startsWith('custom:') ? 0.9 : 0.97, exact: true };
  // Catalog questions with a country fallback: "work_authorization:ANY" answers "work_authorization:US" only if nothing better
  if (!m.key.startsWith('custom:')) {
    // Country variants: a country-less question can use a country-specific answer (and vice versa),
    // but only as a suggestion to review — never as a confident match.
    const [base, country] = m.key.split(':');
    if (country) {
      const variants = saved.filter((s) => s.questionKey.split(':')[0] === base);
      const pick = country === 'ANY' ? (variants.find((s) => s.questionKey.endsWith(':US')) ?? variants[0]) : variants.find((s) => s.questionKey.endsWith(':ANY'));
      if (pick) return { answer: pick, confidence: 0.7, exact: false };
    }
    return null;
  }
  let best: AnswerLookup | null = null;
  for (const s of saved) {
    if (!s.questionKey.startsWith('custom:')) continue;
    const sim = Math.max(questionSimilarity(question, s.rawQuestion), questionSimilarity(question, s.normalizedQuestion));
    if (sim >= minSimilarity && (!best || sim > best.confidence)) best = { answer: s, confidence: sim, exact: false };
  }
  return best;
}
