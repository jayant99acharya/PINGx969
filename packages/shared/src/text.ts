/** Text normalization, tokenization, light stemming and similarity helpers. */

export const STOPWORDS = new Set(
  `a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each etc few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just let me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves
  able across along among around within without via per using use used well new strong excellent good great ability including include includes plus must may might shall within across able etc e.g i.e eg ie ideal ideally candidate candidates role team teams company work working job position opportunity looking seeking join you'll we're you're our we'll will`.split(
    /\s+/,
  ),
);

/** Tokens that carry symbols and must survive tokenization intact. */
const SPECIAL_TOKENS = ['c++', 'c#', 'f#', '.net', 'node.js', 'next.js', 'vue.js', 'react.js', 'ci/cd', 'tcp/ip', 'a/b', 'pl/sql', 'objective-c', 'asp.net', 'express.js', 'nest.js', 'd3.js', 'three.js', 'nuxt.js'];

export function normalizeWhitespace(s: string): string {
  return s.replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function stripDiacritics(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

export function normalizeText(s: string): string {
  return normalizeWhitespace(
    stripDiacritics(s)
      .replace(/[‘’‛]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[‐-―]/g, '-'),
  );
}

export function tokenize(s: string): string[] {
  const lower = normalizeText(s).toLowerCase();
  const out: string[] = [];
  const re = /[a-z0-9][a-z0-9+#./'-]*[a-z0-9+#]|[a-z0-9]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lower))) {
    let t = m[0];
    if (SPECIAL_TOKENS.includes(t)) {
      out.push(t);
      continue;
    }
    // split on internal separators except for special tokens
    for (const part of t.split(/[/.']/)) {
      t = part.replace(/^-+|-+$/g, '');
      if (!t) continue;
      if (t.includes('-')) {
        out.push(...t.split('-').filter(Boolean));
      } else out.push(t);
    }
  }
  return out;
}

/** Light suffix-stripping stemmer (deterministic, good enough for overlap scoring). */
export function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length <= 3 || /[^a-z]/.test(w)) return w;
  const rules: [RegExp, string][] = [
    [/ies$/, 'y'],
    [/sses$/, 'ss'],
    [/([^s])s$/, '$1'],
  ];
  for (const [re, rep] of rules) if (re.test(w)) { w = w.replace(re, rep); break; }
  const suffixes: [RegExp, string][] = [
    [/ational$/, 'ate'],
    [/ization$/, 'ize'],
    [/isation$/, 'ize'],
    [/fulness$/, 'ful'],
    [/iveness$/, 'ive'],
    [/ability$/, 'able'],
    [/ments?$/, ''],
    [/ations?$/, 'ate'],
    [/ingly$/, ''],
    [/edly$/, ''],
    [/ing$/, ''],
    [/ed$/, ''],
    [/ly$/, ''],
    [/ers?$/, ''],
    [/ity$/, ''],
    [/ive$/, ''],
    [/ize$/, ''],
    [/ise$/, ''],
    [/al$/, ''],
    [/e$/, ''],
  ];
  for (const [re, rep] of suffixes) {
    if (re.test(w)) {
      const next = w.replace(re, rep);
      if (next.length >= 3) {
        w = next;
        break;
      }
    }
  }
  // collapse doubled final consonant (running -> run)
  if (/([b-df-hj-np-tv-z])\1$/.test(w) && !/(ll|ss|zz)$/.test(w)) w = w.slice(0, -1);
  return w;
}

/** Action-verb / concept synonym groups used for responsibility matching. */
const SYNONYM_GROUPS: string[][] = [
  ['build', 'develop', 'implement', 'create', 'engineer', 'write', 'code', 'program', 'construct', 'ship'],
  ['design', 'architect', 'plan', 'model'],
  ['lead', 'manage', 'own', 'drive', 'head', 'oversee', 'direct', 'spearhead'],
  ['improve', 'optimize', 'enhance', 'increase', 'boost', 'streamline', 'accelerate', 'speed'],
  ['reduce', 'decrease', 'cut', 'lower', 'minimize'],
  ['scale', 'scalable', 'scalability', 'growth'],
  ['deploy', 'release', 'launch', 'deliver', 'rollout', 'productionize'],
  ['maintain', 'support', 'operate', 'run', 'sustain'],
  ['collaborate', 'partner', 'coordinate', 'cooperate', 'cross-functional', 'crossfunctional', 'stakeholder'],
  ['mentor', 'coach', 'train', 'teach', 'onboard', 'guide'],
  ['test', 'verify', 'validate', 'qa', 'quality'],
  ['monitor', 'observability', 'alert', 'telemetry', 'logging', 'metric'],
  ['automate', 'automation', 'automatic', 'pipeline'],
  ['analyze', 'analysis', 'analytic', 'investigate', 'research', 'evaluate', 'assess'],
  ['debug', 'troubleshoot', 'diagnose', 'fix', 'resolve', 'incident'],
  ['api', 'apis', 'endpoint', 'endpoints', 'rest', 'interface'],
  ['service', 'microservice', 'backend', 'server', 'server-side'],
  ['frontend', 'front-end', 'ui', 'user interface', 'client-side', 'web'],
  ['database', 'datastore', 'db', 'sql', 'storage', 'schema'],
  ['reliable', 'reliability', 'availability', 'uptime', 'resilient', 'resilience', 'robust'],
  ['performance', 'latency', 'throughput', 'efficient', 'efficiency', 'fast'],
  ['secure', 'security', 'compliance', 'privacy'],
  ['customer', 'user', 'client'],
  ['document', 'documentation', 'spec', 'specification'],
  ['review', 'feedback', 'code review'],
  ['cloud', 'aws', 'gcp', 'azure', 'infrastructure'],
];

const synonymIndex = new Map<string, string>();
SYNONYM_GROUPS.forEach((g, i) => {
  for (const w of g) synonymIndex.set(stem(w), `syn${i}`);
});

export function conceptOf(token: string): string {
  const st = stem(token);
  return synonymIndex.get(st) ?? st;
}

/** Content terms: tokens minus stopwords, stemmed and mapped to synonym concepts. */
export function contentTerms(s: string): string[] {
  return tokenize(s)
    .filter((t) => !STOPWORDS.has(t) && !/^\d+$/.test(t) && t.length > 1)
    .map(conceptOf);
}

export function termSet(s: string): Set<string> {
  return new Set(contentTerms(s));
}

export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Fraction of `query` terms present in `doc` (asymmetric containment). */
export function containment<T>(query: Set<T>, doc: Set<T>): number {
  if (!query.size) return 0;
  let inter = 0;
  for (const x of query) if (doc.has(x)) inter++;
  return inter / query.size;
}

export function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [, v] of a) na += v * v;
  for (const [, v] of b) nb += v * v;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (w) dot += v * w;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function termFreq(terms: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of terms) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split text into sentences/bullets. */
export function splitSentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.replace(/^[\s•●▪◦‣\-*–—·]+/, '').trim())
    .filter((s) => s.length > 2);
}

export function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

export function uid(prefix = ''): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Extract numeric "facts" (numbers, percentages, money) from text for fabrication checks. */
export function extractNumbers(s: string): string[] {
  const out: string[] = [];
  const re = /[$€£]?\d[\d,]*(?:\.\d+)?\s*(?:%|percent|[kKmMbB]\b|x\b)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[0].replace(/[\s,]/g, '').toLowerCase().replace('percent', '%'));
  return out;
}

export function hasMetric(s: string): boolean {
  return /\d/.test(s.replace(/\b(19|20)\d{2}\b/g, ''));
}

export function capitalizeFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
