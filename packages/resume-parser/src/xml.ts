import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { AppError, ErrorCodes } from '@pingx969/shared';

export type XElement = Element;

export function parseXml(xml: string): Document {
  let failed = '';
  const doc = new DOMParser({
    onError: (level: string, msg: string) => {
      if (level === 'fatalError' || level === 'error') failed ||= msg;
    },
  }).parseFromString(xml, 'text/xml') as unknown as Document;
  if (failed || !doc?.documentElement) {
    throw new AppError(ErrorCodes.CORRUPTED_FILE, 'The document XML is malformed and could not be read.', 422);
  }
  return doc;
}

export function serializeXml(doc: Document): string {
  return new XMLSerializer().serializeToString(doc as never);
}

export function children(el: Element | Document, name?: string): Element[] {
  const out: Element[] = [];
  const nodes = el.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i] as Element;
    if (n.nodeType === 1 && (!name || n.nodeName === name)) out.push(n);
  }
  return out;
}

export function child(el: Element | null | undefined, name: string): Element | null {
  if (!el) return null;
  return children(el, name)[0] ?? null;
}

export function descendants(el: Element | Document, name: string): Element[] {
  return Array.from((el as Element).getElementsByTagName(name)) as Element[];
}

export function attr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null;
  const v = el.getAttribute(name);
  return v === null || v === '' ? (el.hasAttribute?.(name) ? '' : null) : v;
}

/** Nearest ancestor with the given node name. */
export function closest(el: Node, name: string): Element | null {
  let cur: Node | null = el.parentNode;
  while (cur) {
    if (cur.nodeType === 1 && cur.nodeName === name) return cur as Element;
    cur = cur.parentNode;
  }
  return null;
}
