import { type Change, type JobAnalysis, extractNumbers, findSkills } from '@pingx969/shared';
import type { FactBase } from './facts';

/**
 * Hallucination protection. Every machine-proposed text change must pass these checks
 * against the candidate's fact base; failures are blocked (never applied) and shown with
 * the reason. User-edited text is the user's own claim and is not blocked.
 */
export interface GuardResult {
  ok: boolean;
  reasons: string[];
}

const DEGREE_CLAIM = /\b(ph\.?\s?d|doctorate|master'?s|m\.s\.|mba|bachelor'?s|b\.s\.|degree)\b/i;
const CERT_CLAIM = /\b(certified|certification|certificate|licensed)\b/i;
const PLACEHOLDER = /\[[^\]]{2,80}\]/g;

const COMMON_CAPITALIZED = new Set(
  'I A An The And Or For With In On At To By Of As Led Built Designed Developed Owned Improved Created Implemented Delivered Drove Managed Migrated Reduced Increased Mentored Collaborated Partnered Shipped Launched Contributed Maintained Wrote Architected Automated Optimized Scaled Established Spearheaded Engineered Notable Experienced Also Senior Junior Staff Principal Lead Software Engineer Developer Backend Frontend Full Stack Recent Highlights Highlight Strong Proven Skilled Responsible Worked Helped Supported Tested Deployed Operated Ran Handled Created Analyzed Delivered Coordinated Facilitated Researched Prototyped Refactored Modernized Introduced Reviewed Trained Coached Guided Simplified Streamlined Accelerated Enabled Resolved Diagnosed Monitored Configured Integrated Containerized Set'.split(
    ' ',
  ),
);

export function guardText(
  before: string | null,
  after: string,
  facts: FactBase,
  opts: { allowPlaceholders?: boolean; isSummary?: boolean; job?: JobAnalysis } = {},
): GuardResult {
  const reasons: string[] = [];
  const text = opts.allowPlaceholders ? after.replace(PLACEHOLDER, '') : after;
  if (!opts.allowPlaceholders && PLACEHOLDER.test(after)) reasons.push('contains an unfilled [placeholder]');
  PLACEHOLDER.lastIndex = 0;
  const prev = before ?? '';

  // 1) Technologies / skills must exist in the candidate's facts.
  const prevSkills = new Set(findSkills(prev).map((m) => m.name));
  for (const m of findSkills(text)) {
    if (prevSkills.has(m.name)) continue;
    if (facts.skills.has(m.name) || facts.implied.has(m.name) || facts.confirmed.has(m.name)) continue;
    reasons.push(`mentions "${m.surface}", which is not in your resume or confirmed skills`);
  }

  // 2) Numbers / metrics must come from the source.
  const prevNums = new Set(extractNumbers(prev));
  const yearsMax = Math.floor(facts.months / 12);
  for (const n of extractNumbers(text)) {
    if (prevNums.has(n)) continue;
    if (opts.isSummary) {
      const yrs = n.match(/^(\d+)\+?$/);
      if (yrs && Number(yrs[1]) <= yearsMax && new RegExp(`${yrs[1]}\\+?\\s*years?`).test(text)) continue;
    }
    if (facts.numbers.has(n) && opts.isSummary) continue;
    reasons.push(`adds the number "${n}", which does not appear in the original text`);
  }

  // 3) Years-of-experience claims can't exceed what the dated roles support.
  for (const m of text.matchAll(/(\d+)\s*\+?\s*years?/gi)) {
    if (Number(m[1]) > yearsMax && !prev.includes(m[0])) reasons.push(`claims ${m[0]} of experience, but your roles add up to about ${yearsMax}`);
  }

  // 4) Degrees and certifications can't be introduced.
  if (DEGREE_CLAIM.test(text) && !DEGREE_CLAIM.test(prev) && !DEGREE_CLAIM.test(facts.allText)) reasons.push('mentions a degree not found in your resume');
  if (CERT_CLAIM.test(text) && !CERT_CLAIM.test(prev) && !CERT_CLAIM.test(facts.allText)) reasons.push('mentions a certification not found in your resume');

  // 5) New proper nouns (companies, products) not present in the source.
  const prevWords = new Set((prev.match(/[A-Za-z][\w+#.-]*/g) ?? []).map((w) => w.toLowerCase()));
  const sentences = text.split(/(?<=[.!?:;])\s+/);
  for (const s of sentences) {
    // Words not glued to a digit ("2M" is a number, not a proper noun "M").
    const ws = s.match(/(?<![\w$€£])[A-Za-z][\w+#.-]+/g) ?? [];
    ws.forEach((w, i) => {
      if (i === 0) return; // sentence-initial
      const clean = w.replace(/[.,]+$/, '');
      if (!/^[A-Z]/.test(clean) || COMMON_CAPITALIZED.has(clean)) return;
      const lower = clean.toLowerCase();
      if (prevWords.has(lower) || facts.vocabulary.has(lower)) return;
      if (findSkills(clean).some((m) => facts.skills.has(m.name) || facts.implied.has(m.name))) return;
      reasons.push(`introduces "${clean}", which does not appear in your resume`);
    });
  }

  // 6) Sanity: rewrites shouldn't balloon.
  if (before && after.length > before.length * 2.5 + 120) reasons.push('is much longer than the original');

  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}

/** Validate a change in place: sets `blocked` and forces `accepted=false` when it fails. */
export function guardChange(change: Change, facts: FactBase): Change {
  if (change.informational || change.edited) return change;
  const after = change.after;
  let res: GuardResult = { ok: true, reasons: [] };
  if (change.kind === 'skill_added' && typeof after === 'string') {
    const names = findSkills(after).map((m) => m.name);
    const known = names.length && names.every((n) => facts.skills.has(n) || facts.implied.has(n) || facts.confirmed.has(n));
    if (!known) res = { ok: false, reasons: [`"${after}" is not supported by your resume or confirmed skills`] };
  } else if (change.kind === 'skills_reordered' && Array.isArray(change.before) && Array.isArray(after)) {
    const b = new Set(change.before.map((x) => x.toLowerCase()));
    const extra = after.filter((x) => !b.has(x.toLowerCase()));
    if (extra.length || after.length !== change.before.length) res = { ok: false, reasons: [`reordering must not add or remove skills (${extra.join(', ') || 'count changed'})`] };
  } else if (change.kind === 'bullets_reordered' && Array.isArray(change.before) && Array.isArray(after)) {
    if (after.length !== change.before.length) res = { ok: false, reasons: ['reordering must keep every bullet'] };
  } else if (typeof after === 'string') {
    res = guardText(typeof change.before === 'string' ? change.before : null, after, facts, {
      allowPlaceholders: change.kind === 'suggestion',
      isSummary: change.kind === 'summary_generated' || change.kind === 'summary_rephrased',
    });
  }
  if (!res.ok) return { ...change, blocked: `Blocked: ${res.reasons.join('; ')}.`, accepted: false };
  return change;
}
