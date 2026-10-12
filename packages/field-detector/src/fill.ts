import { answerPolarity, chooseOption } from '@pingx969/profile';
import { type DetectedField, elementsFor } from './detect';
import { DIAL_CODE_ONLY, PLACEHOLDER_TEXT, byIdNear, comboboxSelection, deepQueryAll, dispatch, isVisible, setChecked, setNativeValue, textOf } from './dom';

export const FILLED_ATTR = 'data-px-filled';

export interface FillResult {
  fieldId: string;
  ok: boolean;
  reason?: string;
}

function stamp(el: Element, value: string) {
  el.setAttribute(FILLED_ATTR, value.slice(0, 200));
}

const optionText = (o: Element) => (o.getAttribute('aria-label') || o.getAttribute('data-value') || o.getAttribute('data-answer-value') || textOf(o) || o.getAttribute('data-option') || '').trim();
const isOn = (o: Element) => o.getAttribute('aria-checked') === 'true' || o.getAttribute('aria-pressed') === 'true';

/** A real user click: pointer/mouse down+up then click (custom widgets often listen to mousedown). */
function press(el: Element) {
  const win = el.ownerDocument.defaultView!;
  const opts = { bubbles: true, cancelable: true, composed: true };
  const Pointer = win.PointerEvent ?? win.MouseEvent;
  el.dispatchEvent(new Pointer('pointerdown', opts));
  el.dispatchEvent(new win.MouseEvent('mousedown', opts));
  el.dispatchEvent(new Pointer('pointerup', opts));
  el.dispatchEvent(new win.MouseEvent('mouseup', opts));
  (el as HTMLElement).click();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Current value of a detected field as the user sees it. */
export function readValue(doc: Document, field: Pick<DetectedField, 'id' | 'kind'> & { widget?: DetectedField['widget'] }): string {
  const els = elementsFor(doc, field);
  if (!els.length) return '';
  const el = els[0] as HTMLInputElement & HTMLSelectElement;
  if (field.widget === 'aria' || field.widget === 'toggle') {
    if (field.kind === 'checkbox') return isOn(el) ? 'Yes' : '';
    return els.filter(isOn).map(optionText).join(', ');
  }
  if (field.widget === 'listbox') {
    const sel = el.querySelector('[role="option"][aria-selected="true"]');
    const shown = sel ? (sel.getAttribute('data-value') ? optionText(sel) : '') : el.tagName === 'INPUT' ? el.value.trim() : textOf(el);
    return shown && !PLACEHOLDER_TEXT.test(shown) ? shown : '';
  }
  switch (field.kind) {
    case 'select': {
      const opt = el.selectedOptions?.[0];
      return opt?.value && !PLACEHOLDER_TEXT.test(opt.text.trim()) ? opt.text.trim() : '';
    }
    case 'radio':
    case 'checkbox-group':
      return (els as HTMLInputElement[])
        .filter((i) => i.checked)
        .map((i) => (i.labels?.[0]?.textContent ?? i.value).trim())
        .join(', ');
    case 'checkbox':
      return el.checked ? 'Yes' : '';
    case 'file':
      return el.files?.[0]?.name ?? '';
    case 'combobox':
      return (el.value ?? '').trim() || comboboxSelection(el);
    default: {
      const v = (el.value ?? '').trim();
      return DIAL_CODE_ONLY.test(v) ? '' : v; // a phone widget's pre-typed "+31" is not an answer
    }
  }
}

/**
 * Write a value into the page like a user would. Never touches fields that already have a
 * value unless `overwrite` is set (the user explicitly chose to replace it).
 */
export async function fillField(doc: Document, field: DetectedField, value: string, opts: { overwrite?: boolean } = {}): Promise<FillResult> {
  const els = elementsFor(doc, field);
  if (!els.length) return { fieldId: field.id, ok: false, reason: 'Field is no longer on the page.' };
  if (!opts.overwrite && readValue(doc, field)) return { fieldId: field.id, ok: false, reason: 'Field already has a value.' };
  const el = els[0];
  try {
    if (field.widget === 'aria' || field.widget === 'toggle') return fillAriaChoice(els, field, value);
    if (field.widget === 'listbox') return await fillListbox(doc, el, field, value);
    switch (field.kind) {
      case 'text':
      case 'email':
      case 'tel':
      case 'url':
      case 'number':
      case 'textarea': {
        const input = el as HTMLInputElement;
        let v = value;
        if (field.kind === 'number') v = (value.match(/\d+(\.\d+)?/) ?? [''])[0];
        if (input.maxLength > 0 && v.length > input.maxLength) v = v.slice(0, input.maxLength);
        setNativeValue(input, v);
        stamp(input, v);
        return { fieldId: field.id, ok: true };
      }
      case 'date': {
        const d = new Date(value);
        const v = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
        if (!v) return { fieldId: field.id, ok: false, reason: 'Value is not a date.' };
        setNativeValue(el as HTMLInputElement, v);
        stamp(el, v);
        return { fieldId: field.id, ok: true };
      }
      case 'select': {
        const sel = el as HTMLSelectElement;
        const opts = Array.from(sel.options).map((o) => ({ label: o.text.trim(), value: o.value, o }));
        const pick = chooseOption(opts, value);
        if (!pick) return { fieldId: field.id, ok: false, reason: `No option matches "${value}".` };
        sel.focus?.();
        sel.value = pick.value;
        pick.o.selected = true;
        dispatch(sel, 'input');
        dispatch(sel, 'change');
        sel.blur?.();
        stamp(sel, pick.label);
        return { fieldId: field.id, ok: true };
      }
      case 'radio': {
        const radios = els as HTMLInputElement[];
        const opts = radios.map((r) => ({ label: (r.labels?.[0] ? r.labels[0].textContent ?? '' : r.getAttribute('aria-label') ?? r.value).trim(), value: r.value, r }));
        const pick = chooseOption(opts, value);
        if (!pick) return { fieldId: field.id, ok: false, reason: `No option matches "${value}".` };
        setChecked(pick.r, true);
        stamp(pick.r, pick.label);
        return { fieldId: field.id, ok: true };
      }
      case 'checkbox': {
        const pol = answerPolarity(value);
        if (!pol) return { fieldId: field.id, ok: false, reason: 'Checkbox needs a yes/no answer.' };
        setChecked(el as HTMLInputElement, pol === 'yes');
        stamp(el, pol);
        return { fieldId: field.id, ok: true };
      }
      case 'checkbox-group': {
        const boxes = els as HTMLInputElement[];
        const wanted = value.split(/\s*[,;]\s*/).filter(Boolean);
        const opts = boxes.map((b) => ({ label: (b.labels?.[0]?.textContent ?? b.value).trim(), value: b.value, b }));
        let any = false;
        for (const w of wanted) {
          const pick = chooseOption(opts, w);
          if (pick) {
            setChecked(pick.b, true);
            any = true;
          }
        }
        if (any) stamp(boxes[0], value);
        return any ? { fieldId: field.id, ok: true } : { fieldId: field.id, ok: false, reason: `No option matches "${value}".` };
      }
      case 'combobox':
        return await fillCombobox(doc, el as HTMLInputElement, field, value);
      case 'file':
        return { fieldId: field.id, ok: false, reason: 'Use attachFile for file inputs.' };
    }
  } catch (e) {
    return { fieldId: field.id, ok: false, reason: (e as Error).message || 'Could not fill this field.' };
  }
  return { fieldId: field.id, ok: false, reason: 'Unsupported field type.' };
}

/** role="radio"/role="checkbox" elements and aria-pressed button rows: click the matching option(s). */
function fillAriaChoice(els: HTMLElement[], field: DetectedField, value: string): FillResult {
  if (field.kind === 'checkbox') {
    const pol = answerPolarity(value);
    if (!pol) return { fieldId: field.id, ok: false, reason: 'Checkbox needs a yes/no answer.' };
    if (isOn(els[0]) !== (pol === 'yes')) press(els[0]);
    stamp(els[0], pol);
    return { fieldId: field.id, ok: true };
  }
  const opts = els.map((o) => ({ label: optionText(o), value: o.getAttribute('data-value') ?? o.getAttribute('data-option') ?? optionText(o), o }));
  const wanted = field.kind === 'checkbox-group' ? value.split(/\s*[,;]\s*/).filter(Boolean) : [value];
  let any = false;
  for (const w of wanted) {
    const pick = chooseOption(opts, w);
    if (!pick) continue;
    if (!isOn(pick.o)) press(pick.o);
    stamp(pick.o, pick.label);
    any = true;
  }
  return any ? { fieldId: field.id, ok: true } : { fieldId: field.id, ok: false, reason: `No option matches "${value}".` };
}

/** Visible role="option" elements, preferring the popup the trigger says it controls. */
function visibleOptions(doc: Document, trigger: Element): HTMLElement[] {
  const ctl = trigger.getAttribute('aria-controls') || trigger.getAttribute('aria-owns');
  const scope = ctl ? byIdNear(trigger, ctl.split(/\s+/)[0]) : null;
  const all = scope ? Array.from(scope.querySelectorAll<HTMLElement>('[role="option"]')) : deepQueryAll<HTMLElement>(doc, '[role="option"]');
  return all.filter((o) => isVisible(o) && !o.closest('[data-px-ui]'));
}

/** Button/div that opens a listbox menu (Workday, BambooHR, Google Forms): open, pick, verify. */
async function fillListbox(doc: Document, trigger: HTMLElement, field: DetectedField, value: string): Promise<FillResult> {
  const before = new Set(visibleOptions(doc, trigger));
  press(trigger);
  for (let i = 0; i < 25; i++) {
    await sleep(60);
    // Options that appeared because of the click (other dropdowns' menus may already be open)
    const fresh = visibleOptions(doc, trigger).filter((o) => !before.has(o) || trigger.contains(o));
    const opts = fresh.map((o) => ({ label: optionText(o), value: o.getAttribute('data-value') ?? optionText(o), o })).filter((o) => o.label && !PLACEHOLDER_TEXT.test(o.label));
    if (!opts.length) continue;
    const pick = chooseOption(opts, value);
    if (!pick) {
      doc.dispatchEvent(new (doc.defaultView!.KeyboardEvent)('keydown', { key: 'Escape', bubbles: true }));
      return { fieldId: field.id, ok: false, reason: `No option matches "${value}".` };
    }
    press(pick.o);
    await sleep(30);
    stamp(trigger, pick.label);
    return { fieldId: field.id, ok: true };
  }
  return { fieldId: field.id, ok: false, reason: 'The dropdown did not open.' };
}

/**
 * ARIA combobox (react-select, location autocompletes): type without blurring (react-select
 * clears typed text on blur), wait for the listbox, click the best option.
 */
async function fillCombobox(doc: Document, input: HTMLInputElement, field: DetectedField, value: string): Promise<FillResult> {
  const win = doc.defaultView!;
  input.focus?.();
  press(input);
  const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new win.InputEvent('input', { bubbles: true, composed: true, data: value, inputType: 'insertText' }));
  input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true }));
  for (let i = 0; i < 25; i++) {
    await sleep(60);
    const options = visibleOptions(doc, input)
      .map((o) => ({ label: optionText(o), value: o.id || optionText(o), o }))
      .filter((o) => o.label && !/^no (options|results)/i.test(o.label));
    if (!options.length) continue;
    const pick = chooseOption(options, value);
    if (!pick) {
      input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
      return { fieldId: field.id, ok: false, reason: `No option matches "${value}".` };
    }
    press(pick.o);
    await sleep(30);
    stamp(input, pick.label);
    return { fieldId: field.id, ok: true };
  }
  // Free-text autocompletes keep what was typed; menus that require a choice clear it.
  await sleep(50);
  if (input.value.trim()) {
    input.dispatchEvent(new win.Event('change', { bubbles: true }));
    stamp(input, value);
    return { fieldId: field.id, ok: true, reason: 'Typed the value; no matching suggestion appeared.' };
  }
  return { fieldId: field.id, ok: false, reason: `No option matches "${value}".` };
}

/** Attach a file (e.g. the tailored resume) to a file input via DataTransfer. */
export function attachFile(doc: Document, field: DetectedField, file: { bytes: Uint8Array; name: string; type: string }): FillResult {
  const input = elementsFor(doc, field)[0] as HTMLInputElement | undefined;
  if (!input) return { fieldId: field.id, ok: false, reason: 'Upload field not found.' };
  const win = doc.defaultView!;
  if (!('DataTransfer' in win)) return { fieldId: field.id, ok: false, reason: 'This browser does not allow attaching files programmatically.' };
  const accept = (input.accept || '').toLowerCase();
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (accept && !accept.split(',').some((a) => a.trim() === `.${ext}` || a.trim() === file.type || (a.trim().endsWith('/*') && file.type.startsWith(a.trim().slice(0, -1))))) {
    return { fieldId: field.id, ok: false, reason: `This upload only accepts ${accept}.` };
  }
  const dt = new win.DataTransfer();
  dt.items.add(new win.File([file.bytes as BlobPart], file.name, { type: file.type }));
  input.files = dt.files;
  dispatch(input, 'input');
  dispatch(input, 'change');
  stamp(input, file.name);
  return { fieldId: field.id, ok: true };
}
