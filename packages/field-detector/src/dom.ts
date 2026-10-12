/** DOM helpers: label discovery, visibility, and framework-safe value setting. */

export type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').replace(/\s*[*✱]\s*$/, '').replace(/^\s*\*\s*/, '').trim();

export function textOf(el: Element | null | undefined): string {
  if (!el) return '';
  // Exclude text inside nested form controls (e.g. option text inside a label) and inline SVG
  // fallback text ("SVGs not supported by this browser.")
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('select, option, script, style, input, textarea, button, svg, [aria-hidden="true"], .visually-hidden-required').forEach((n) => n.remove());
  return clean(clone.textContent);
}

/** Every open shadow root under `root` (web-component forms such as SmartRecruiters). Skips our own UI. */
export function shadowRoots(root: Document | Element | ShadowRoot): ShadowRoot[] {
  const out: ShadowRoot[] = [];
  const visit = (r: Document | Element | ShadowRoot) => {
    for (const el of Array.from(r.querySelectorAll('*'))) {
      const sr = (el as Element).shadowRoot;
      if (sr && !(el as Element).hasAttribute('data-px-ui')) {
        out.push(sr);
        visit(sr);
      }
    }
  };
  visit(root);
  return out;
}

/** querySelectorAll that also searches open shadow roots, in document order per tree. */
export function deepQueryAll<T extends Element = Element>(root: Document | Element | ShadowRoot, selector: string): T[] {
  const out: T[] = Array.from(root.querySelectorAll<T>(selector));
  for (const sr of shadowRoots(root)) out.push(...Array.from(sr.querySelectorAll<T>(selector)));
  return out;
}

/** react-select keeps the chosen option in a sibling "single-value" element, not in the input. */
export function comboboxSelection(input: Element): string {
  const control = input.closest('[class*="control"]');
  return textOf(control?.querySelector('[class*="single-value"], [class*="singleValue"]'));
}

/** getElementById scoped to the element's own tree (document or shadow root). */
export function byIdNear(el: Element, id: string): Element | null {
  const r = el.getRootNode() as Document | ShadowRoot;
  return (r.getElementById?.(id) as Element | null) ?? el.ownerDocument.getElementById(id);
}

function isJsdom(doc: Document): boolean {
  return /jsdom/i.test(doc.defaultView?.navigator.userAgent ?? '');
}

export function isVisible(el: Element): boolean {
  if ((el as HTMLInputElement).type === 'hidden') return false;
  if (el.closest('[hidden], [aria-hidden="true"], template')) return false;
  const win = el.ownerDocument.defaultView;
  let cur: Element | null = el;
  while (cur && win) {
    const st = win.getComputedStyle(cur);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    cur = cur.parentElement;
  }
  if (!isJsdom(el.ownerDocument)) {
    const r = el.getBoundingClientRect();
    // Custom-styled radios/checkboxes are often 0x0 but their label is visible.
    if (r.width === 0 && r.height === 0) {
      const t = (el as HTMLInputElement).type;
      if (t === 'radio' || t === 'checkbox' || t === 'file') return true;
      return false;
    }
  }
  return true;
}

export function labelFor(el: Element): string {
  const parts: string[] = [];
  const labelled = el.getAttribute('aria-labelledby');
  if (labelled) {
    for (const id of labelled.split(/\s+/)) {
      const t = textOf(byIdNear(el, id));
      if (t) parts.push(t);
    }
    if (parts.length) return parts.join(' ');
  }
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length) {
    const t = Array.from(labels).map((l) => textOf(l)).filter(Boolean).join(' ');
    if (t) return t;
  }
  const aria = clean(el.getAttribute('aria-label'));
  if (aria) return aria;
  const wrap = el.closest('label');
  if (wrap) {
    const t = textOf(wrap);
    if (t) return t;
  }
  return '';
}

/** Upload-button captions that say nothing about what the field is for. */
export const GENERIC_CAPTION = /^(attach|upload( file)?|choose( a)? file|browse|select file|drop files? here)$/i;

/** Nearby descriptive text: preceding siblings / ancestor containers (for unlabeled fields). */
export function contextText(el: Element, maxDepth = 4): string {
  let cur: Element | null = el;
  for (let depth = 0; depth < maxDepth && cur; depth++) {
    let sib = cur.previousElementSibling;
    let hops = 0;
    while (sib && hops < 3) {
      // A <label for> that names a different, existing control is that control's label, not ours. (A label
      // whose `for` points nowhere — Kula's `for="field-_r_1_"` next to `id="info.first_name"` — still counts.)
      const target = sib.tagName === 'LABEL' ? (sib as HTMLLabelElement).htmlFor : '';
      const otherLabel = !!target && target !== el.id && !!byIdNear(sib, target);
      if (!otherLabel && !sib.querySelector('input, select, textarea') && !/^(INPUT|SELECT|TEXTAREA|BUTTON|SCRIPT|STYLE)$/.test(sib.tagName)) {
        const t = textOf(sib);
        if (t && t.length <= 300 && !GENERIC_CAPTION.test(t)) return t;
      }
      sib = sib.previousElementSibling;
      hops++;
    }
    cur = cur.parentElement;
    if (cur && /^(FORM|BODY)$/.test(cur.tagName)) break;
  }
  return '';
}

export function legendFor(el: Element): string {
  const fs = el.closest('fieldset');
  if (fs) {
    const lg = fs.querySelector(':scope > legend');
    if (lg) return textOf(lg);
  }
  const group = el.closest('[role="radiogroup"], [role="group"], [role="list"]');
  if (group) {
    const lb = group.getAttribute('aria-labelledby');
    if (lb) return textOf(byIdNear(el, lb.split(/\s+/)[0]));
    const al = group.getAttribute('aria-label');
    if (al) return clean(al);
  }
  return '';
}

export function isRequired(el: Element, label: string): boolean {
  return (el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true' || /\*\s*$|\(required\)/i.test(label);
}

/** Set a value the way a user would, so React/Vue/Angular controlled inputs notice. */
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof el.ownerDocument.defaultView!.HTMLTextAreaElement ? el.ownerDocument.defaultView!.HTMLTextAreaElement.prototype : el.ownerDocument.defaultView!.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  el.focus?.();
  if (setter) setter.call(el, value);
  else el.value = value;
  dispatch(el, 'input');
  dispatch(el, 'change');
  el.blur?.();
}

export function dispatch(el: Element, type: string): void {
  const win = el.ownerDocument.defaultView!;
  const ev = type === 'input' ? new win.Event('input', { bubbles: true }) : new win.Event(type, { bubbles: true });
  el.dispatchEvent(ev);
}

export function setChecked(el: HTMLInputElement, checked: boolean): void {
  if (el.checked === checked) return;
  // click() fires the full event sequence frameworks listen to
  el.click();
  if (el.checked !== checked) {
    const setter = Object.getOwnPropertyDescriptor(el.ownerDocument.defaultView!.HTMLInputElement.prototype, 'checked')?.set;
    setter?.call(el, checked);
    dispatch(el, 'change');
  }
}

export function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

/** "Select One", "– Select –", "-- Choose --", "Make a Selection"…: a dropdown with nothing chosen. */
export const PLACEHOLDER_TEXT = /^[\s\-–—]*(select|choose|please|none selected|pick|make a selection|--)|^[-–—]+\s*none\s*[-–—]+$/i;

/** A value that is only an international dialling prefix ("+31", "+1 "): phone widgets pre-type it. */
export const DIAL_CODE_ONLY = /^\+\s?\d{1,4}[\s-]*$/;
