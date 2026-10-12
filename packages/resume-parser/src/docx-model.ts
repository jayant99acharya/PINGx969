import { attr, child, children, closest, descendants } from './xml';

/**
 * DOCX paragraph text model shared by the parser and the format-preserving exporter.
 * A paragraph's visible text is a sequence of "atoms" (w:t text, w:tab, w:br) that
 * belong to runs (w:r). Paragraph indices are positions in document order of all w:p
 * elements in word/document.xml — the exporter uses the same enumeration.
 */
export interface Atom {
  node: Element; // w:t | w:tab | w:br | w:cr
  run: Element;
  text: string;
  start: number;
}

export function allParagraphs(doc: Document): Element[] {
  const body = descendants(doc, 'w:body')[0];
  return body ? descendants(body, 'w:p') : [];
}

/** Atoms belonging to this paragraph (excludes nested text-box paragraphs). */
export function paragraphAtoms(p: Element): Atom[] {
  const atoms: Atom[] = [];
  let pos = 0;
  const runs = descendants(p, 'w:r').filter((r) => closest(r, 'w:p') === p);
  for (const run of runs) {
    // Skip deleted text in tracked changes; include inserted text.
    if (closest(run, 'w:del')) continue;
    for (const n of children(run)) {
      let text: string | null = null;
      if (n.nodeName === 'w:t') text = n.textContent ?? '';
      else if (n.nodeName === 'w:tab' || n.nodeName === 'w:ptab') text = '\t';
      else if (n.nodeName === 'w:br' || n.nodeName === 'w:cr') {
        const type = attr(n, 'w:type');
        text = type === 'page' ? '\n' : '\n';
      } else if (n.nodeName === 'w:noBreakHyphen') text = '-';
      else if (n.nodeName === 'w:sym') {
        text = '•';
      }
      if (text === null) continue;
      atoms.push({ node: n, run, text, start: pos });
      pos += text.length;
    }
  }
  return atoms;
}

export function paragraphText(p: Element): string {
  return paragraphAtoms(p)
    .map((a) => a.text)
    .join('');
}

/** Run-level formatting; `null` means "not set on the run" (inherit from paragraph style). */
export function runProps(run: Element): { bold: boolean | null; italic: boolean | null; size: number | null; font: string; caps: boolean | null } {
  const rPr = child(run, 'w:rPr');
  const flag = (name: string) => {
    const el = child(rPr, name);
    if (!el) return null;
    const v = attr(el, 'w:val');
    return !(v === '0' || v === 'false' || v === 'off');
  };
  const sz = child(rPr, 'w:sz');
  const fonts = child(rPr, 'w:rFonts');
  return {
    bold: flag('w:b'),
    italic: flag('w:i'),
    caps: flag('w:caps'),
    size: sz ? Number(attr(sz, 'w:val')) / 2 : null,
    font: attr(fonts, 'w:ascii') ?? attr(fonts, 'w:hAnsi') ?? '',
  };
}

/**
 * Replace the paragraph's text with `next`, touching only the differing middle region so
 * untouched runs keep their exact formatting (bold labels, links, fonts).
 */
export function replaceParagraphText(p: Element, next: string): boolean {
  const atoms = paragraphAtoms(p);
  const old = atoms.map((a) => a.text).join('');
  if (old === next) return false;
  const clean = next.replace(/[\n\t]+/g, ' ');
  let pre = 0;
  while (pre < old.length && pre < clean.length && old[pre] === clean[pre]) pre++;
  let suf = 0;
  while (
    suf < old.length - pre &&
    suf < clean.length - pre &&
    old[old.length - 1 - suf] === clean[clean.length - 1 - suf]
  )
    suf++;
  const oldEnd = old.length - suf;
  const middle = clean.slice(pre, clean.length - suf);

  // Find the first text atom overlapping [pre, oldEnd) or touching `pre`.
  const textAtoms = atoms.filter((a) => a.node.nodeName === 'w:t');
  let anchor = textAtoms.find((a) => a.start <= pre && pre < a.start + a.text.length) ??
    textAtoms.find((a) => a.start + a.text.length === pre) ??
    textAtoms.find((a) => a.start >= pre);
  const docRef = p.ownerDocument!;
  if (!anchor) {
    // Paragraph has no text node at all (e.g. only a tab): create a run.
    const lastRun = descendants(p, 'w:r').pop();
    const r = lastRun ?? p.appendChild(docRef.createElement('w:r'));
    const t = docRef.createElement('w:t');
    t.setAttribute('xml:space', 'preserve');
    r.appendChild(t);
    anchor = { node: t, run: r, text: '', start: old.length };
  }
  for (const a of atoms) {
    const aEnd = a.start + a.text.length;
    if (a === anchor) continue;
    if (aEnd <= pre || a.start >= oldEnd) continue;
    // atom overlaps the replaced region
    if (a.node.nodeName === 'w:t') {
      const keepFrom = Math.max(0, oldEnd - a.start);
      const keepTo = Math.min(a.text.length, pre - a.start);
      let remaining = '';
      if (a.start < pre) remaining = a.text.slice(0, Math.max(0, keepTo));
      if (aEnd > oldEnd) remaining += a.text.slice(keepFrom);
      setText(a.node, remaining);
    } else if (a.start >= pre && aEnd <= oldEnd) {
      a.node.parentNode?.removeChild(a.node);
    }
  }
  const aStart = anchor.start;
  const localPre = Math.max(0, pre - aStart);
  const localEnd = Math.min(anchor.text.length, Math.max(localPre, oldEnd - aStart));
  setText(anchor.node, anchor.text.slice(0, localPre) + middle + anchor.text.slice(localEnd));
  return true;
}

function setText(t: Element, text: string) {
  while (t.firstChild) t.removeChild(t.firstChild);
  t.appendChild(t.ownerDocument!.createTextNode(text));
  t.setAttribute('xml:space', 'preserve');
}
