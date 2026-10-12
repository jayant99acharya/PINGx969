/** Resume date parsing and experience-duration arithmetic. */

export interface YearMonth {
  year: number;
  month: number; // 1-12
  /** The source only gave a year ("2018"). */
  yearOnly?: boolean;
}

export interface DateRange {
  start: YearMonth | null;
  end: YearMonth | 'present' | null;
  text: string;
  index: number;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11,
  november: 11, dec: 12, december: 12, spring: 3, summer: 6, fall: 9, autumn: 9, winter: 12,
};

const MONTH_RE = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|spring|summer|fall|autumn|winter)\\.?';
const SINGLE = `(?:${MONTH_RE}\\s*,?\\s*(?:19|20)\\d{2}|(?:0?[1-9]|1[0-2])\\s*[/.-]\\s*(?:19|20)\\d{2}|(?:19|20)\\d{2}\\s*[/.-]\\s*(?:0?[1-9]|1[0-2])(?!\\d)|(?:19|20)\\d{2})`;
const PRESENT = '(?:present|current(?:ly)?|now|today|ongoing|date)';
export const DATE_RANGE_RE = new RegExp(
  `(${SINGLE})\\s*(?:-|–|—|to|until|through|thru|~)\\s*(${SINGLE}|${PRESENT})`,
  'gi',
);
export const SINGLE_DATE_RE = new RegExp(`(${SINGLE})`, 'gi');

export function parseSingleDate(s: string): YearMonth | 'present' | null {
  const t = s.trim().toLowerCase().replace(/\.$/, '');
  if (new RegExp(`^${PRESENT}$`, 'i').test(t)) return 'present';
  let m = t.match(new RegExp(`^(${MONTH_RE})\\s*,?\\s*((?:19|20)\\d{2})$`, 'i'));
  if (m) {
    const key = m[1].replace('.', '').toLowerCase();
    const month = MONTHS[key] ?? MONTHS[key.slice(0, 3)] ?? 1;
    return { year: Number(m[2]), month };
  }
  m = t.match(/^(0?[1-9]|1[0-2])\s*[/.-]\s*((?:19|20)\d{2})$/);
  if (m) return { year: Number(m[2]), month: Number(m[1]) };
  m = t.match(/^((?:19|20)\d{2})\s*[/.-]\s*(0?[1-9]|1[0-2])$/);
  if (m) return { year: Number(m[1]), month: Number(m[2]) };
  m = t.match(/^((?:19|20)\d{2})$/);
  if (m) return { year: Number(m[1]), month: 1, yearOnly: true };
  return null;
}

export function findDateRanges(text: string): DateRange[] {
  const out: DateRange[] = [];
  const re = new RegExp(DATE_RANGE_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = parseSingleDate(m[1]);
    const end = parseSingleDate(m[2]);
    out.push({
      start: start === 'present' ? null : start,
      end,
      text: m[0],
      index: m.index,
    });
  }
  return out;
}

export function formatYearMonth(ym: YearMonth | 'present' | null): string {
  if (!ym) return '';
  if (ym === 'present') return 'present';
  if (ym.yearOnly) return String(ym.year);
  return `${ym.year}-${String(ym.month).padStart(2, '0')}`;
}

export function parseIsoYearMonth(s: string): YearMonth | 'present' | null {
  if (!s) return null;
  if (s === 'present') return 'present';
  const m = s.match(/^(\d{4})(?:-(\d{1,2}))?/);
  if (!m) return null;
  return { year: Number(m[1]), month: m[2] ? Number(m[2]) : 1 };
}

function toIndex(ym: YearMonth): number {
  return ym.year * 12 + (ym.month - 1);
}

/** Total distinct months covered by the given ranges (overlaps counted once). */
export function totalMonths(
  ranges: { start: string; end: string }[],
  now: Date = new Date(),
): number {
  const nowYm = { year: now.getFullYear(), month: now.getMonth() + 1 };
  const intervals: [number, number][] = [];
  for (const r of ranges) {
    const s = parseIsoYearMonth(r.start);
    const e = parseIsoYearMonth(r.end);
    if (!s || s === 'present') continue;
    const endYm = !e || e === 'present' ? (r.end === 'present' ? nowYm : s) : e;
    const a = toIndex(s);
    const b = toIndex(endYm) + 1;
    if (b > a) intervals.push([a, Math.min(b, toIndex(nowYm) + 1)]);
  }
  intervals.sort((x, y) => x[0] - y[0]);
  let total = 0;
  let curS = -1;
  let curE = -1;
  for (const [a, b] of intervals) {
    if (a > curE) {
      if (curE > curS) total += curE - curS;
      curS = a;
      curE = b;
    } else curE = Math.max(curE, b);
  }
  if (curE > curS) total += curE - curS;
  return total;
}

export function formatDateForDisplay(s: string): string {
  const ym = parseIsoYearMonth(s);
  if (!ym) return '';
  if (ym === 'present') return 'Present';
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return /^\d{4}$/.test(s) ? String(ym.year) : `${names[ym.month - 1]} ${ym.year}`;
}
