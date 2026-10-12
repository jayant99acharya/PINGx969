import type { FieldType } from '@pingx969/shared';
import { normalizeQuestion } from '@pingx969/profile';
import { CONSENT_RE, type FieldSignals, classifySignals } from './classify';
import { type FormControl, DIAL_CODE_ONLY, GENERIC_CAPTION, PLACEHOLDER_TEXT, comboboxSelection, contextText, deepQueryAll, isRequired, isVisible, labelFor, legendFor, textOf } from './dom';
import { type JobSiteAdapter, pickAdapter } from './adapters';

export type ControlKind = 'text' | 'email' | 'tel' | 'url' | 'number' | 'date' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'checkbox-group' | 'file' | 'combobox';

/**
 * How the control is operated. Custom widgets reuse the native kinds (so planning and the review
 * panel treat them the same) but are read and filled differently:
 *   native   <input>/<select>/<textarea>
 *   aria     elements with role="radio" / role="checkbox" (Google Forms, Workable)
 *   toggle   a row of <button aria-pressed> choices (Ashby Yes/No)
 *   listbox  a button/div that opens a role="listbox" menu (Workday, BambooHR, Google Forms dropdowns)
 */
export type Widget = 'native' | 'aria' | 'toggle' | 'listbox';

export interface FieldOption {
  label: string;
  value: string;
}

export interface DetectedField {
  id: string;
  kind: ControlKind;
  fieldType: FieldType;
  confidence: number;
  label: string;
  /** The question text, for screening questions. */
  question: string | null;
  questionKey: string | null;
  questionNormalized: string | null;
  contextual: boolean;
  sensitive: boolean;
  consent: boolean;
  options: FieldOption[];
  required: boolean;
  currentValue: string;
  multiple: boolean;
  name: string;
  /** Host-independent descriptor used to remember user corrections. */
  signature: string;
  adapter: string;
  accept: string;
  widget: Widget;
}

export const FIELD_ATTR = 'data-px-field';
let counter = 0;

function fieldId(el: Element, groupKey?: string): string {
  const existing = el.getAttribute(FIELD_ATTR);
  if (existing) return existing;
  const id = groupKey ? `g${hash(groupKey)}` : `f${(++counter).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  return id;
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'password', 'search', 'range', 'color']);

function kindOf(el: FormControl): ControlKind | null {
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea') return 'textarea';
  if (tag === 'select') return 'select';
  const t = ((el as HTMLInputElement).type || 'text').toLowerCase();
  if (SKIP_TYPES.has(t)) return null;
  if (el.getAttribute('role') === 'combobox' && (el as HTMLInputElement).readOnly) return null; // a read-only combobox is a dropdown button (Oracle JET): handled as a listbox widget
  if (el.getAttribute('role') === 'combobox' && t === 'text') return 'combobox';
  if (t === 'radio' || t === 'checkbox' || t === 'file' || t === 'email' || t === 'tel' || t === 'url' || t === 'number' || t === 'date') return t;
  return 'text';
}

function signalsOf(el: FormControl, label: string, context: string): FieldSignals {
  return {
    label,
    name: el.getAttribute('name') ?? '',
    id: el.id ?? '',
    placeholder: el.getAttribute('placeholder') ?? '',
    autocomplete: el.getAttribute('autocomplete') ?? '',
    ariaDescription: el.getAttribute('aria-description') ?? '',
    context,
    automationId: el.getAttribute('data-automation-id') ?? el.closest('[data-automation-id]')?.getAttribute('data-automation-id') ?? el.getAttribute('data-qa') ?? '',
    inputType: ((el as HTMLInputElement).type || el.tagName).toLowerCase(),
    tag: el.tagName.toLowerCase(),
  };
}

function optionLabel(input: HTMLInputElement): string {
  return labelFor(input) || input.getAttribute('aria-label') || input.value || '';
}

const IGNORED_NAME = /captcha|honey-?pot|^q$|search/i;

/** A <select> hidden (aria-hidden, 1px) behind a visible select2 widget: the select is what gets filled. */
function isSelect2Backed(el: FormControl): boolean {
  if (el.tagName !== 'SELECT' || !el.classList.contains('select2-hidden-accessible')) return false;
  const widget = el.nextElementSibling;
  return !!widget?.classList.contains('select2-container') && isVisible(widget);
}

/** A native radio/checkbox that only backs a custom widget (the widget itself is what users click). */
function isBackingInput(el: FormControl): boolean {
  const t = (el as HTMLInputElement).type;
  if (t !== 'radio' && t !== 'checkbox') return false;
  if (el.parentElement?.closest('[role="radio"], [role="checkbox"]')) return true;
  return !!el.parentElement && Array.from(el.parentElement.children).filter((c) => c.matches('button[aria-pressed]')).length >= 2;
}

/** Detect, group and classify every fillable control in `root`, including open shadow roots and ARIA widgets. */
export function detectFields(root: Document | Element = document, opts: { adapter?: JobSiteAdapter; url?: string } = {}): DetectedField[] {
  const doc = (root as Element).ownerDocument ?? (root as Document);
  const adapter = opts.adapter ?? pickAdapter(opts.url ?? doc.location?.href ?? '', doc);
  const controls = deepQueryAll<FormControl>(root, 'input, select, textarea').filter(
    (el) => !el.closest('[data-px-ui]') && !el.disabled && kindOf(el) !== null && (isVisible(el) || isSelect2Backed(el)) && !IGNORED_NAME.test(`${el.name} ${el.id}`) && !isBackingInput(el),
  );
  const fields: DetectedField[] = [];
  const anchors = new Map<string, Element>();
  const push = (f: DetectedField, anchor: Element) => {
    fields.push(f);
    anchors.set(f.id, anchor);
  };
  const groups = new Map<string, HTMLInputElement[]>();

  for (const el of controls) {
    const kind = kindOf(el)!;
    if ((kind === 'radio' || kind === 'checkbox') && el.getAttribute('name')) {
      const form = el.form ? Array.from(doc.forms).indexOf(el.form) : -1;
      // Checkbox groups whose options are numbered fields of one question (JazzHR: q-123-1, q-123-2…)
      const name = kind === 'checkbox' ? el.getAttribute('name')!.replace(/([-_]\d+|\[\d+\])$/, '') : el.getAttribute('name');
      const key = `${kind}:${form}:${name}`;
      const arr = groups.get(key) ?? [];
      arr.push(el as HTMLInputElement);
      groups.set(key, arr);
      continue;
    }
    if (kind === 'radio') {
      // unnamed radios: group by fieldset
      const fs = el.closest('fieldset, [role="radiogroup"]');
      const key = `radio:fs:${fs ? Array.from(doc.querySelectorAll('fieldset, [role="radiogroup"]')).indexOf(fs) : Math.random()}`;
      const arr = groups.get(key) ?? [];
      arr.push(el as HTMLInputElement);
      groups.set(key, arr);
      continue;
    }
    push(buildField(el, kind, adapter), el);
  }

  for (const [key, inputs] of groups) {
    const first = inputs[0];
    const isCheckbox = first.type === 'checkbox';
    if (isCheckbox && inputs.length === 1) {
      push(buildField(first, 'checkbox', adapter), first);
      continue;
    }
    const kind: ControlKind = isCheckbox ? 'checkbox-group' : 'radio';
    const label = legendFor(first) || groupQuestion(inputs) || first.getAttribute('name') || '';
    const id = fieldId(first, key);
    for (const i of inputs) i.setAttribute(FIELD_ATTR, id);
    const options = inputs.map((i) => ({ label: optionLabel(i), value: i.value }));
    const checked = inputs.filter((i) => i.checked).map(optionLabel);
    push(finalize({ el: first, id, kind, label, options, currentValue: checked.join(', '), multiple: isCheckbox, adapter, required: inputs.some((i) => isRequired(i, label)) }), first);
  }

  for (const w of detectWidgets(root, adapter)) push(w.field, w.anchor);

  // Keep DOM order (across shadow trees)
  return fields.sort((a, b) => compareDeep(anchors.get(a.id)!, anchors.get(b.id)!));
}

/** Document order for elements that may live in different (shadow) trees. */
function compareDeep(a: Element, b: Element): number {
  const chain = (e: Element) => {
    const c: Element[] = [e];
    let r = e.getRootNode() as Node & { host?: Element };
    while (r.host) {
      c.unshift(r.host);
      r = r.host.getRootNode() as Node & { host?: Element };
    }
    return c;
  };
  const ca = chain(a);
  const cb = chain(b);
  for (let i = 0; i < Math.min(ca.length, cb.length); i++) {
    if (ca[i] !== cb[i]) {
      const p = ca[i].compareDocumentPosition(cb[i]);
      return p & 4 ? -1 : p & 2 ? 1 : 0;
    }
  }
  return ca.length - cb.length;
}

/** For radio/checkbox groups without a legend: text right before the group container. */
function groupQuestion(inputs: Element[]): string {
  let container: Element | null = inputs[0].parentElement;
  while (container && !inputs.every((i) => container!.contains(i))) container = container.parentElement;
  if (!container) return '';
  const aria = container.getAttribute('aria-label');
  if (aria) return aria;
  // A leading label inside the shared container (JazzHR: <div><label>Question</label> + option rows)
  for (const child of Array.from(container.children)) {
    if (child.querySelector('input, select, textarea, [role="radio"], [role="checkbox"]') || /^(INPUT|SELECT|TEXTAREA|SCRIPT|STYLE)$/.test(child.tagName)) {
      if (child.tagName === 'INPUT' && (child as HTMLInputElement).type === 'hidden') continue;
      break;
    }
    const t = textOf(child);
    if (t && t.length <= 300) return t;
  }
  return questionHeading(container) || contextText(container, 3);
}

/** Question title of a Google-Forms-style item (role="listitem" with a role="heading"). */
function questionHeading(el: Element): string {
  const item = el.closest('[role="listitem"]');
  return item ? textOf(item.querySelector('[role="heading"]')) : '';
}

const ariaOptionLabel = (o: Element) => (o.getAttribute('aria-label') || o.getAttribute('data-value') || o.getAttribute('data-answer-value') || textOf(o) || o.getAttribute('data-option') || '').trim();

/** Custom (non-native) choice widgets: ARIA radios/checkboxes, aria-pressed button rows, listbox dropdowns. */
function detectWidgets(root: Document | Element, adapter: JobSiteAdapter): { field: DetectedField; anchor: Element }[] {
  const out: { field: DetectedField; anchor: Element }[] = [];
  const usable = (el: Element) => !el.closest('[data-px-ui]') && el.getAttribute('aria-disabled') !== 'true' && !(el as HTMLButtonElement).disabled && isVisible(el);

  // ARIA radio groups (native inputs inside role="radio" wrappers are skipped above)
  const radioGroups = new Map<Element, Element[]>();
  for (const r of deepQueryAll(root, '[role="radio"]')) {
    if (r.tagName === 'INPUT' || !usable(r)) continue;
    const g = r.closest('[role="radiogroup"]') ?? r.parentElement!;
    radioGroups.set(g, [...(radioGroups.get(g) ?? []), r]);
  }
  for (const [g, opts] of radioGroups) out.push({ field: widgetField('radio', 'aria', g, opts, adapter), anchor: opts[0] });

  // Rows of toggle buttons (Ashby "Yes" / "No")
  const toggleGroups = new Map<Element, Element[]>();
  for (const b of deepQueryAll(root, 'button[aria-pressed]')) {
    if (!usable(b) || !b.parentElement) continue;
    toggleGroups.set(b.parentElement, [...(toggleGroups.get(b.parentElement) ?? []), b]);
  }
  for (const [g, opts] of toggleGroups) {
    const short = opts.every((o) => {
      const t = textOf(o) || o.getAttribute('aria-label') || '';
      return t.length > 0 && t.length <= 40;
    });
    if (short && opts.length >= 2 && opts.length <= 8) out.push({ field: widgetField('radio', 'toggle', g, opts, adapter), anchor: opts[0] });
  }

  // ARIA checkboxes: grouped when several share a container
  const boxGroups = new Map<Element, Element[]>();
  for (const c of deepQueryAll(root, '[role="checkbox"]')) {
    if (c.tagName === 'INPUT' || !usable(c)) continue;
    const g = c.closest('[role="group"], [role="list"], fieldset') ?? c.parentElement!;
    boxGroups.set(g, [...(boxGroups.get(g) ?? []), c]);
  }
  for (const [g, opts] of boxGroups) {
    if (opts.length === 1) out.push({ field: widgetField('checkbox', 'aria', opts[0], opts, adapter), anchor: opts[0] });
    else out.push({ field: widgetField('checkbox-group', 'aria', g, opts, adapter), anchor: opts[0] });
  }

  // Listbox dropdowns: a trigger button (Workday/BambooHR/SmartRecruiters) or a role="listbox" with aria-expanded (Google Forms)
  for (const t of deepQueryAll(root, 'button[aria-haspopup="listbox"], [role="combobox"]:not(input), input[role="combobox"][readonly], [role="listbox"][aria-expanded]')) {
    if (!usable(t) || t.closest('[role="listbox"]') !== (t.getAttribute('role') === 'listbox' ? t : null) || t.querySelector('input')) continue;
    // select2 (Keka and many jQuery sites) draws a combobox over a hidden native <select>; the select is
    // detected and filled natively (select2 follows its change event), so the look-alike is skipped.
    if (t.closest('.select2-container')) continue;
    out.push({ field: widgetField('select', 'listbox', t, [t], adapter), anchor: t });
  }
  return out;
}

function widgetField(kind: ControlKind, widget: Widget, group: Element, opts: Element[], adapter: JobSiteAdapter): DetectedField {
  const first = opts[0];
  let label: string;
  let options: FieldOption[] = [];
  let currentValue: string;
  if (widget === 'listbox') {
    // A trigger labelled only "Select" (Rippling's aria-label) says nothing: look for the question nearby,
    // which can sit several wrappers up.
    const own = labelFor(first);
    const generic = PLACEHOLDER_TEXT.test(own) && own.length <= 20; // "Select", "Select One" — not "Select country calling code: …"
    label = adapter.label?.(first) || (own && !generic ? own : '') || questionHeading(first) || contextText(first, 8) || own;
    // Options already in the DOM (Google Forms); others render only when the menu opens.
    options = Array.from(first.querySelectorAll('[role="option"]'))
      .map((o) => ({ label: ariaOptionLabel(o), value: o.getAttribute('data-value') ?? ariaOptionLabel(o) }))
      .filter((o) => o.value && !PLACEHOLDER_TEXT.test(o.label));
    const selected = first.querySelector('[role="option"][aria-selected="true"]');
    const shown = selected ? (selected.getAttribute('data-value') ? ariaOptionLabel(selected) : '') : first.tagName === 'INPUT' ? (first as HTMLInputElement).value.trim() : textOf(first);
    currentValue = shown && !PLACEHOLDER_TEXT.test(shown) && shown !== label ? shown : '';
  } else if (kind === 'checkbox') {
    label = labelFor(first) || ariaOptionLabel(first);
    currentValue = first.getAttribute('aria-checked') === 'true' ? 'Yes' : '';
  } else {
    label = adapter.label?.(group) || labelFor(group) || legendFor(first) || (group.previousElementSibling?.tagName === 'LABEL' ? textOf(group.previousElementSibling) : '') || groupQuestion(opts);
    options = opts.map((o) => ({ label: ariaOptionLabel(o), value: o.getAttribute('data-value') ?? o.getAttribute('data-option') ?? ariaOptionLabel(o) }));
    currentValue = opts
      .filter((o) => o.getAttribute('aria-checked') === 'true' || o.getAttribute('aria-pressed') === 'true')
      .map(ariaOptionLabel)
      .join(', ');
  }
  const key = `${widget}:${kind}:${label}:${options.map((o) => o.value).join('|')}`;
  const id = fieldId(first, key);
  for (const o of opts) o.setAttribute(FIELD_ATTR, id);
  const required = group.getAttribute('aria-required') === 'true' || first.getAttribute('aria-required') === 'true' || /\*\s*$/.test(label);
  return finalize({ el: first as FormControl, id, kind, label, options, currentValue, multiple: kind === 'checkbox-group', adapter, required, widget });
}

/** Placeholders that name the field ("City", "Postal") rather than instruct ("Type your response"). */
const NAMING_PLACEHOLDER = (p: string) => !!p && p.length <= 40 && !/^(type|enter|start typing|search|select|choose|e\.g\.|eg\b|your answer|write|add|ex\b|example|\.\.\.|https?:)/i.test(p);

function buildField(el: FormControl, kind: ControlKind, adapter: JobSiteAdapter): DetectedField {
  let label = adapter.label?.(el) || labelFor(el);
  // "Attach" on Greenhouse's upload button: the real caption is the nearby "Resume/CV" text.
  if (kind === 'file' && GENERIC_CAPTION.test(label)) label = contextText(el.closest('label') ?? el) || label;
  const placeholder = el.getAttribute('placeholder') ?? '';
  if (!label && NAMING_PLACEHOLDER(placeholder)) label = placeholder;
  // <input type=checkbox><span>I agree to …</span>: a checkbox's caption usually follows it.
  if (!label && kind === 'checkbox') {
    const next = el.nextElementSibling;
    if (next && !next.matches('input, select, textarea') && !next.querySelector('input, select, textarea')) label = textOf(next);
  }
  const ctx = label ? '' : contextText(el);
  const id = fieldId(el);
  el.setAttribute(FIELD_ATTR, id);
  let options: FieldOption[] = [];
  let currentValue: string;
  if (kind === 'select') {
    const sel = el as HTMLSelectElement;
    options = Array.from(sel.options).map((o) => ({ label: o.text.trim(), value: o.value }));
    const opt = sel.selectedOptions[0];
    currentValue = opt && opt.value && !PLACEHOLDER_TEXT.test(opt.text.trim()) ? opt.text.trim() : '';
  } else if (kind === 'checkbox') {
    currentValue = (el as HTMLInputElement).checked ? 'Yes' : '';
  } else if (kind === 'file') {
    currentValue = (el as HTMLInputElement).files?.length ? (el as HTMLInputElement).files![0].name : '';
  } else {
    currentValue = (el as HTMLInputElement).value || (kind === 'combobox' ? comboboxSelection(el) : '');
    if (DIAL_CODE_ONLY.test(currentValue)) currentValue = ''; // "+31 " pre-typed by phone widgets is not an answer
  }
  return finalize({ el, id, kind, label: label || ctx || el.getAttribute('placeholder') || '', options, currentValue, multiple: (el as HTMLSelectElement).multiple ?? false, adapter, required: isRequired(el, label), context: ctx });
}

/** Heading of the closest enclosing section ("E-Signature", "Voluntary Disclosures"…), searching up a few levels. */
function sectionHeading(el: Element): string {
  let cur = el.parentElement;
  for (let depth = 0; cur && depth < 6 && cur.tagName !== 'FORM' && cur.tagName !== 'BODY'; depth++, cur = cur.parentElement) {
    const h = cur.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > legend, :scope > [role="heading"]');
    if (h) return textOf(h);
  }
  return '';
}

const SIGNATURE_RE =/\b(e-?signature|electronic signature|esign(ature)?|sign(ed)? (here|below)|type your (full |legal )?name (to|as your) sign)/i;
const CONSENT_OPTION_RE =/\b(i (do not |don't )?(consent|agree|accept)|(yes|no),? i (do not )?consent)\b/i;

function finalize(p: { el: FormControl; id: string; kind: ControlKind; label: string; options: FieldOption[]; currentValue: string; multiple: boolean; adapter: JobSiteAdapter; required: boolean; context?: string; widget?: Widget }): DetectedField {
  const { el, kind, options } = p;
  const label = p.label
    // visually-hidden "Required" glued onto labels (Teamtailor): "First nameRequired", "WorkerRequired Are you…"
    .replace(/(?<=[A-Za-z0-9)?:])Required(?=\s+[A-Z])/g, ' ')
    .replace(/(?<=[A-Za-z0-9)?:.])Required$/, '')
    .replace(/^Required\.\s*/, '')
    .replace(/\s*[*✱]\s*$/, '').replace(/\s*\(required\)\s*$/i, '').trim();
  const sig = signalsOf(el, label, p.context ?? '');
  let cls = classifySignals(sig);
  const hint = p.adapter.hint?.(el, sig);
  // An adapter's exact-identifier hint wins ties with label matching ("Mobile Phone" labels both the
  // number and Keka's mobilePhone.countryCode select).
  if (hint && hint.confidence >= cls.confidence) cls = { ...cls, type: hint.fieldType, confidence: hint.confidence };

  let fieldType: FieldType = cls.type;
  let confidence = cls.confidence;
  let questionKey: string | null = null;
  let questionNormalized: string | null = null;
  let contextual = false;
  let sensitive = false;
  let question: string | null = null;
  // Legal acknowledgements are never answered automatically: consent checkboxes, and radio
  // groups whose options are "Yes, I consent" / "No, I do not consent" (SMS/GDPR opt-ins).
  // Typing your name into an e-signature box (Oracle, Workday, iCIMS) is signing: never automatic.
  const signature = kind !== 'file' && (SIGNATURE_RE.test(label) || SIGNATURE_RE.test(`${sig.name} ${sig.id} ${sig.context}`) || SIGNATURE_RE.test(sectionHeading(el)));
  const consent =
    signature ||
    (kind === 'checkbox' && (CONSENT_RE.test(label) || /consent|agree|terms|privacy|gdpr|certif/i.test(`${sig.name} ${sig.id}`))) ||
    (kind === 'radio' &&
      (options.some((o) => CONSENT_OPTION_RE.test(o.label)) ||
        // a Yes/No (or true/false) opt-in: "Check Yes or No to indicate your agreement to receive text messages"
        ((CONSENT_RE.test(label) || /\bagreement\b|text messages?|\bsms\b|opt[- ]?in|marketing/i.test(label)) && options.every((o) => /^(yes|no|true|false)$/i.test(o.label.trim())))));
  const choiceLike = kind === 'radio' || kind === 'select' || kind === 'checkbox-group' || kind === 'checkbox';

  // A confident standard field ("Email", "LinkedIn") stays as is; anything question-like or
  // ambiguous is normalized so equivalent questions across sites share one saved answer.
  const strongStandard = confidence >= 0.9 && !cls.looksLikeQuestion;
  if (kind !== 'file' && label && !strongStandard && (cls.looksLikeQuestion || confidence < 0.8 || choiceLike)) {
    const m = normalizeQuestion(label);
    const catalog = !m.key.startsWith('custom:');
    if (catalog || confidence < 0.6) {
      fieldType = catalog ? (m.fieldType ?? 'question') : 'question';
      questionKey = m.key;
      questionNormalized = m.normalized;
      contextual = m.contextual;
      sensitive = m.sensitive;
      question = label;
      confidence = catalog ? 0.9 : 0.5;
    }
  }
  if (consent) {
    fieldType = 'question';
    question = label;
    const m = normalizeQuestion(label);
    questionKey = m.key;
    questionNormalized = m.normalized;
  }
  // A single checkbox only holds yes/no: "Record my email address with my response" mentions an
  // email but is a question, not the email field.
  if (kind === 'checkbox' && !questionKey && fieldType !== 'question') fieldType = 'unknown';
  if (fieldType === 'unknown' && label && kind !== 'file') {
    // Unrecognized but labeled: treat as a custom question so the user can save an answer.
    const m = normalizeQuestion(label);
    fieldType = 'question';
    question = label;
    questionKey = m.key;
    questionNormalized = m.normalized;
    confidence = 0.4;
  }
  if (['gender', 'raceEthnicity', 'hispanicLatino', 'veteranStatus', 'disabilityStatus', 'desiredSalary'].includes(fieldType)) sensitive = true;

  const name = el.getAttribute('name') ?? '';
  return {
    id: p.id,
    kind,
    fieldType,
    confidence: Math.round(confidence * 100) / 100,
    label,
    question,
    questionKey,
    questionNormalized,
    contextual,
    sensitive,
    consent,
    options: options.filter((o) => o.label || o.value),
    required: p.required,
    currentValue: p.currentValue.trim(),
    multiple: p.multiple,
    name,
    signature: `${kind}:${name.toLowerCase().replace(/\d{3,}/g, '#')}:${label.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').slice(0, 80)}`,
    adapter: p.adapter.name,
    accept: el.getAttribute('accept') ?? '',
    widget: p.widget ?? 'native',
  };
}

export function elementsFor(doc: Document, field: Pick<DetectedField, 'id'>): HTMLElement[] {
  return deepQueryAll<HTMLElement>(doc, `[${FIELD_ATTR}="${field.id}"]`);
}

/** Heuristic: does this page look like a job application form? */
export function looksLikeApplication(fields: DetectedField[]): boolean {
  const types = new Set(fields.map((f) => f.fieldType));
  const identity = types.has('email') || types.has('firstName') || types.has('fullName');
  return (identity && fields.length >= 3) || types.has('resume');
}

export { textOf };
