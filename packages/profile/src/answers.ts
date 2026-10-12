import { normalizeText, tokenize } from '@pingx969/shared';
import { countryCode } from './questions';

export type Polarity = 'yes' | 'no' | null;

export function answerPolarity(answer: string): Polarity {
  const t = normalizeText(answer).toLowerCase().replace(/[.!]+$/, '').trim();
  if (!t) return null;
  if (/^(yes|y|true|yeah|yep|i am|i do|i will|i have|i can|i would|correct|authorized|affirmative)\b/.test(t)) {
    if (/^(i am|i do|i will|i have|i can|i would)\s+not\b/.test(t)) return 'no';
    return 'yes';
  }
  if (/^(no|n|false|nope|i am not|i'm not|i do not|i don't|i will not|i won't|i have not|i haven't|i cannot|i can't|not|none|never)\b/.test(t)) return 'no';
  return null;
}

const SYNONYM_GROUPS: string[][] = [
  ['prefer not to say', 'decline to self identify', 'decline to self-identify', 'i don\'t wish to answer', 'i do not wish to answer', 'prefer not to answer', 'decline to answer', 'choose not to disclose', 'i prefer not to disclose', 'not specified', 'decline'],
  ['male', 'man', 'm'],
  ['female', 'woman', 'f'],
  ['non-binary', 'nonbinary', 'non binary', 'genderqueer'],
  ['i am not a protected veteran', 'not a veteran', 'i am not a veteran', 'no military service'],
  ['i identify as one or more of the classifications of protected veteran', 'protected veteran', 'i am a protected veteran'],
  ['no, i do not have a disability', 'no, i don\'t have a disability', 'i do not have a disability', 'no disability'],
  ['yes, i have a disability', 'i have a disability', 'yes, i have a disability (or previously had a disability)'],
  ['asian', 'asian (not hispanic or latino)'],
  ['white', 'white (not hispanic or latino)', 'caucasian'],
  ['black or african american', 'black', 'african american', 'black or african american (not hispanic or latino)'],
  ['two or more races', 'two or more races (not hispanic or latino)', 'multiracial'],
  ['immediately', 'asap', 'as soon as possible', 'now'],
  ['linkedin', 'linked in', 'linkedin.com'],
];

const STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
};

export function stateVariants(s: string): string[] {
  const t = s.trim();
  const up = t.toUpperCase();
  if (STATES[up]) return [up, STATES[up]];
  const code = Object.entries(STATES).find(([, n]) => n.toLowerCase() === t.toLowerCase())?.[0];
  return code ? [code, STATES[code]] : [t];
}

function norm(s: string): string {
  return normalizeText(s).toLowerCase().replace(/[*]/g, '').replace(/\s+/g, ' ').trim();
}

function variants(answer: string): Set<string> {
  const a = norm(answer);
  const out = new Set<string>([a]);
  for (const g of SYNONYM_GROUPS) if (g.includes(a)) g.forEach((x) => out.add(x));
  for (const v of stateVariants(answer)) out.add(norm(v));
  const cc = countryCode(answer);
  if (cc === 'US') ['united states', 'united states of america', 'usa', 'us', 'u.s.'].forEach((x) => out.add(x));
  return out;
}

export interface OptionLike {
  label: string;
  value: string;
}

const PLACEHOLDER_OPTION = /^(select|choose|please select|--|—|-|\s*)(\s|\.|…|an option|one|\.\.\.)*$|^[-–—]+\s*none\s*[-–—]+$/i;

/** Pick the option that best represents `answer`. Returns null when nothing is a confident match. */
export function chooseOption<T extends OptionLike>(options: T[], answer: string): T | null {
  const real = options.filter((o) => !PLACEHOLDER_OPTION.test(o.label.trim()) && o.label.trim() !== '');
  if (!real.length || !answer.trim()) return null;
  const vs = variants(answer);
  // 1) exact (label or value)
  for (const o of real) if (vs.has(norm(o.label)) || vs.has(norm(o.value))) return o;
  // 2) yes/no polarity
  const pol = answerPolarity(answer);
  if (pol) {
    const matching = real.filter((o) => answerPolarity(o.label) === pol);
    if (matching.length >= 1) return matching.sort((a, b) => a.label.length - b.label.length)[0];
  }
  // 3) dialing code: "+1" -> "United States (+1)" / "+1"
  const dial = answer.trim().match(/^\+\s*(\d{1,4})$/);
  if (dial) {
    // "+1" must not match "+1-684" (American Samoa) or "+12"
    const re = new RegExp(`\\+\\s*${dial[1]}(?!\\d|-\\d)`);
    const hit = real.find((o) => re.test(o.label) || re.test(o.value));
    if (hit) return hit;
  }
  // 4) synonym/containment
  for (const o of real) {
    const l = norm(o.label);
    for (const v of vs) if (v.length >= 3 && (l.startsWith(v) || (l.includes(v) && v.length >= 5))) return o;
  }
  // 5) token overlap
  const at = new Set(tokenize(answer));
  let best: T | null = null;
  let bestScore = 0;
  for (const o of real) {
    const ot = new Set(tokenize(o.label));
    let inter = 0;
    for (const x of at) if (ot.has(x)) inter++;
    const score = inter / Math.max(1, Math.max(at.size, ot.size));
    if (score > bestScore) {
      best = o;
      bestScore = score;
    }
  }
  if (best && bestScore >= 0.6) return best;
  // 6) numeric ranges ("5" -> "5-7 years")
  const num = Number(answer.match(/\d+(\.\d+)?/)?.[0]);
  if (Number.isFinite(num)) {
    for (const o of real) {
      const r = o.label.match(/(\d+)\s*(?:-|–|to)\s*(\d+)/);
      if (r && num >= Number(r[1]) && num <= Number(r[2])) return o;
      const plus = o.label.match(/(\d+)\s*\+/);
      if (plus && num >= Number(plus[1])) return o;
      const less = o.label.match(/(less than|under|<)\s*(\d+)/i);
      if (less && num < Number(less[2])) return o;
    }
  }
  return null;
}
