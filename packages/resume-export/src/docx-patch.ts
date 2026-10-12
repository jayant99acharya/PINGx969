import type { ResumeData, ResumeDocument } from '@pingx969/shared';
import {
  allParagraphs,
  child,
  children,
  descendants,
  loadDocxZip,
  paragraphText,
  parseXml,
  replaceParagraphText,
  serializeXml,
} from '@pingx969/resume-parser';
import { computeEdits, replaceBulletText, replaceSkillSpan } from './edits';

/**
 * Format-preserving DOCX export: edits the ORIGINAL document.xml in place. Only the text of
 * changed paragraphs is touched (run-level minimal diff), reordered bullets are moved as whole
 * paragraphs (keeping their numbering and inline formatting), and everything else — styles,
 * fonts, spacing, numbering, headers, section/page setup — is byte-for-byte the original.
 */
export async function patchDocx(
  originalBytes: Uint8Array,
  document: ResumeDocument,
  original: ResumeData,
  optimized: ResumeData,
): Promise<{ bytes: Uint8Array; warnings: string[] }> {
  const zip = await loadDocxZip(originalBytes);
  const xml = await zip.file('word/document.xml')!.async('string');
  const doc = parseXml(xml);
  const paragraphs = allParagraphs(doc);
  const warnings: string[] = [];
  const edits = computeEdits(original, optimized);
  const pOf = (line: number): Element | null => {
    const idx = document.lines[line]?.paragraph;
    return idx === null || idx === undefined ? null : (paragraphs[idx] ?? null);
  };
  const multiLine = (p: Element) => paragraphText(p).includes('\n');

  // 1) Bullet text
  for (const e of edits.bulletText) {
    const p = pOf(e.line);
    if (!p) {
      warnings.push(`Could not locate a bullet in the original document: "${e.oldText.slice(0, 50)}…"`);
      continue;
    }
    const raw = paragraphText(p);
    const next = replaceBulletText(raw, e.oldText, e.newText) ?? (multiLine(p) ? null : e.newText);
    if (next === null) {
      warnings.push(`A bullet inside a multi-line paragraph was left unchanged: "${e.oldText.slice(0, 50)}…"`);
      continue;
    }
    replaceParagraphText(p, next);
  }

  // 2) Skills lines
  for (const s of edits.skills) {
    const p = pOf(s.line);
    if (!p) continue;
    const raw = paragraphText(p);
    const next = replaceSkillSpan(raw, s.oldItems, s.newItems, s.delimiter);
    if (next === null) {
      warnings.push(`Skills line "${raw.slice(0, 40)}" could not be updated in place.`);
      continue;
    }
    replaceParagraphText(p, next);
  }

  // 3) Summary (rewrite in place, or insert a new section cloned from existing styles)
  if (edits.summary) {
    const ps = [...new Set(edits.summary.lines.map((l) => pOf(l)).filter((x): x is Element => !!x))];
    if (ps.length) {
      replaceParagraphText(ps[0], edits.summary.newText);
      for (const extra of ps.slice(1)) extra.parentNode?.removeChild(extra);
    }
  } else if (edits.summaryInsert) {
    const firstHeading = original.headings.find((h) => h.line !== null);
    const headingP = firstHeading ? pOf(firstHeading.line!) : null;
    const bodyTemplate = findBodyTemplate(paragraphs, document);
    if (headingP && bodyTemplate) {
      const hClone = headingP.cloneNode(true) as Element;
      const hText = paragraphText(headingP);
      replaceParagraphText(hClone, hText === hText.toUpperCase() ? 'SUMMARY' : 'Summary');
      const bClone = makePlainParagraph(bodyTemplate, edits.summaryInsert);
      headingP.parentNode!.insertBefore(hClone, headingP);
      headingP.parentNode!.insertBefore(bClone, headingP);
    } else warnings.push('A summary was generated but could not be inserted into this document layout.');
  }

  // 4) Bullet reordering: move whole paragraphs when they are consecutive siblings.
  for (const r of edits.reorders) {
    const nodes = r.lines.map((l) => pOf(l));
    const target = r.newOrder.map((l) => pOf(l));
    if (nodes.some((n) => !n) || target.some((n) => !n)) continue;
    const ns = nodes as Element[];
    const parent = ns[0].parentNode;
    const consecutive = ns.every((n, i) => n.parentNode === parent && (i === 0 || nextElement(ns[i - 1]) === n)) && new Set(ns).size === ns.length;
    if (!consecutive || !parent) {
      warnings.push('Some bullets were not reordered because they are not stored as consecutive paragraphs.');
      continue;
    }
    const anchor = nextElement(ns[ns.length - 1]);
    for (const n of ns) parent.removeChild(n);
    for (const n of target as Element[]) parent.insertBefore(n, anchor);
  }

  zip.file('word/document.xml', serializeXml(doc));
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  return { bytes, warnings };
}

function nextElement(n: Element): Element | null {
  let cur = n.nextSibling;
  while (cur && cur.nodeType !== 1) cur = cur.nextSibling;
  return (cur as Element) ?? null;
}

/** A normal body paragraph (not a bullet, heading, or table cell) to clone styles from. */
function findBodyTemplate(paragraphs: Element[], document: ResumeDocument): Element | null {
  const candidates = document.lines.filter((l) => !l.bullet && !l.headingStyle && !l.inTable && l.paragraph !== null && l.text.split(/\s+/).length > 6 && !l.bold);
  const pick = candidates[0] ?? document.lines.find((l) => !l.bullet && !l.headingStyle && l.paragraph !== null && l.text.trim());
  return pick ? paragraphs[pick.paragraph!] : null;
}

function makePlainParagraph(template: Element, text: string): Element {
  const p = template.cloneNode(true) as Element;
  const pPr = child(p, 'w:pPr');
  const numPr = child(pPr, 'w:numPr');
  if (numPr) pPr!.removeChild(numPr);
  // Keep a copy of one regular (preferably non-bold) run as the formatting carrier; drop the rest.
  const runs = descendants(p, 'w:r').filter((r) => descendants(r, 'w:t').length);
  const source = runs.find((r) => !child(child(r, 'w:rPr'), 'w:b')) ?? runs[runs.length - 1];
  const carrier = source ? (source.cloneNode(true) as Element) : null;
  for (const c of children(p)) if (c.nodeName !== 'w:pPr') p.removeChild(c);
  if (carrier) {
    for (const n of children(carrier)) if (n.nodeName !== 'w:rPr' && n.nodeName !== 'w:t') carrier.removeChild(n);
    descendants(carrier, 'w:t').slice(1).forEach((t) => carrier.removeChild(t));
    p.appendChild(carrier);
  }
  replaceParagraphText(p, text);
  return p;
}

