/**
 * Minimal PDF content-stream rewriter: removes text-showing operators whose baseline lies
 * outside a vertical band, so clipped page slices don't carry invisible (but extractable)
 * duplicate text. Graphics are left alone (they are clipped by the slice's bounding box).
 *
 * Tracks the CTM (q/Q/cm) and text matrices (BT, Td, TD, Tm, T*, TL, ', ") — enough for the
 * horizontal text that resumes use.
 */
type M = [number, number, number, number, number, number];
const I: M = [1, 0, 0, 1, 0, 0];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);

/**
 * @param keep receives the baseline y in PDF user space (bottom-up) of each text-show operator.
 */
export function filterTextByBaseline(content: Uint8Array, keep: (y: number) => boolean, keepPath?: (minY: number, maxY: number) => boolean): Uint8Array {
  const s = Buffer.from(content).toString('latin1');
  const n = s.length;
  let i = 0;
  let opStart = -1;
  const nums: number[] = [];
  const edits: { start: number; end: number; replacement: string }[] = [];
  let ctm: M = [...I];
  const stack: M[] = [];
  let tm: M = [...I];
  let tlm: M = [...I];
  let leading = 0;
  // current path (for dropping vector shapes that lie entirely outside the band)
  let pathStart = -1;
  let pathYs: number[] = [];
  let clipping = false;
  const pt = (x: number, y: number) => ctm[1] * x + ctm[3] * y + ctm[5];

  const markStart = (pos: number) => {
    if (opStart < 0) opStart = pos;
  };
  const baseline = () => mul(tm, ctm)[5];
  const nextLine = () => {
    tlm = mul([1, 0, 0, 1, 0, -leading], tlm);
    tm = [...tlm];
  };

  while (i < n) {
    const c = s[i];
    const code = s.charCodeAt(i);
    if (WS.has(code)) {
      i++;
      continue;
    }
    if (c === '%') {
      while (i < n && s[i] !== '\n' && s[i] !== '\r') i++;
      continue;
    }
    if (c === '(') {
      markStart(i);
      let depth = 0;
      for (; i < n; i++) {
        const ch = s[i];
        if (ch === '\\') {
          i++;
          continue;
        }
        if (ch === '(') depth++;
        else if (ch === ')') {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
      }
      continue;
    }
    if (c === '<' && s[i + 1] === '<') {
      markStart(i);
      i += 2;
      continue;
    }
    if (c === '>' && s[i + 1] === '>') {
      i += 2;
      continue;
    }
    if (c === '<') {
      markStart(i);
      const end = s.indexOf('>', i);
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (c === '[' || c === ']' || c === '{' || c === '}') {
      if (c === '[') markStart(i);
      i++;
      continue;
    }
    if (c === '/') {
      markStart(i);
      i++;
      while (i < n && !WS.has(s.charCodeAt(i)) && !DELIM.has(s[i])) i++;
      continue;
    }
    // number or operator/keyword
    const start = i;
    while (i < n && !WS.has(s.charCodeAt(i)) && !DELIM.has(s[i])) i++;
    const tok = s.slice(start, i);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) {
      markStart(start);
      nums.push(Number(tok));
      continue;
    }
    if (tok === 'true' || tok === 'false' || tok === 'null') {
      markStart(start);
      continue;
    }
    // ---- operator
    const from = opStart < 0 ? start : opStart;
    const a = nums.slice(-6);
    switch (tok) {
      case 'm':
      case 'l':
      case 'c':
      case 'v':
      case 'y':
      case 're': {
        if (pathStart < 0) pathStart = from;
        const v = nums.slice();
        if (tok === 're' && v.length >= 4) {
          const [x, y0, , hh] = v.slice(-4);
          pathYs.push(pt(x, y0), pt(x, y0 + hh));
        } else for (let k = 0; k + 1 < v.length; k += 2) pathYs.push(pt(v[k], v[k + 1]));
        break;
      }
      case 'h':
        break;
      case 'W':
      case 'W*':
        clipping = true;
        break;
      case 'S':
      case 's':
      case 'f':
      case 'F':
      case 'f*':
      case 'B':
      case 'B*':
      case 'b':
      case 'b*':
      case 'n':
        if (keepPath && pathStart >= 0 && !clipping && pathYs.length && !keepPath(Math.min(...pathYs), Math.max(...pathYs))) {
          edits.push({ start: pathStart, end: i, replacement: tok === 'n' ? 'n' : '' });
        }
        pathStart = -1;
        pathYs = [];
        clipping = false;
        break;
      case 'q':
        stack.push([...ctm] as M);
        break;
      case 'Q':
        ctm = stack.pop() ?? [...I];
        break;
      case 'cm':
        if (a.length === 6) ctm = mul(a as M, ctm);
        break;
      case 'BT':
        tm = [...I];
        tlm = [...I];
        break;
      case 'Td':
      case 'TD': {
        const [tx, ty] = nums.slice(-2);
        if (tok === 'TD') leading = -ty;
        tlm = mul([1, 0, 0, 1, tx, ty], tlm);
        tm = [...tlm];
        break;
      }
      case 'Tm':
        if (a.length === 6) {
          tlm = a as M;
          tm = [...tlm];
        }
        break;
      case 'TL':
        leading = nums[nums.length - 1] ?? leading;
        break;
      case 'T*':
        nextLine();
        break;
      case 'Tj':
      case 'TJ':
        if (!keep(baseline())) edits.push({ start: from, end: i, replacement: '' });
        break;
      case "'":
        nextLine();
        if (!keep(baseline())) edits.push({ start: from, end: i, replacement: 'T*' });
        break;
      case '"': {
        const [aw, ac] = nums.slice(-2);
        nextLine();
        if (!keep(baseline())) edits.push({ start: from, end: i, replacement: `${aw} Tw ${ac} Tc T*` });
        break;
      }
      case 'BI': {
        // inline image: skip binary data up to "EI"
        const id = s.indexOf('ID', i);
        const m = id < 0 ? -1 : s.slice(id + 2).search(/\sEI(\s|$)/);
        i = m < 0 ? n : id + 2 + m + 3;
        break;
      }
    }
    opStart = -1;
    nums.length = 0;
  }
  if (!edits.length) return content;
  let out = '';
  let pos = 0;
  for (const e of edits) {
    out += s.slice(pos, e.start) + e.replacement;
    pos = e.end;
  }
  out += s.slice(pos);
  return new Uint8Array(Buffer.from(out, 'latin1'));
}
