import type { FieldType, Profile } from '@pingx969/shared';
import { type SavedAnswerLike, chooseOption, findSavedAnswer, profileAnswerFor, resolveFieldValue } from '@pingx969/profile';
import type { DetectedField, FieldOption } from './detect';

/**
 * ready    ✓ confident value from profile/saved answers
 * review   ⚠ value found but should be checked (contextual question, fuzzy match, option mismatch)
 * unknown  ? no saved answer — never guessed
 * prefilled  field already has a value; kept unless the user chooses to replace it
 * manual   consent/legal checkbox — the user must do it themselves
 * file     resume/cover letter upload
 * skipped  optional field with nothing to fill
 */
export type PlanStatus = 'ready' | 'review' | 'unknown' | 'prefilled' | 'manual' | 'file' | 'skipped';

export interface PlanItem {
  fieldId: string;
  label: string;
  kind: DetectedField['kind'];
  fieldType: FieldType;
  status: PlanStatus;
  /** Raw value to write (for choice fields: the matched option's label). */
  value: string;
  source: 'profile' | 'saved' | 'mapping' | 'none';
  confidence: number;
  note: string;
  question: string | null;
  questionKey: string | null;
  questionNormalized: string | null;
  sensitive: boolean;
  required: boolean;
  options: FieldOption[];
  currentValue: string;
  signature: string;
  savedAnswerId: string | null;
}

export interface AutofillData {
  profile: Profile;
  answers: (SavedAnswerLike & { id?: string })[];
  mappings: { host: string; signature: string; fieldType: string; questionKey: string | null }[];
}

export interface PlanContext {
  host: string;
  company?: string;
  title?: string;
}

const OPTIONAL_STANDARD: FieldType[] = ['middleName', 'preferredName', 'address2', 'twitter', 'portfolio', 'website', 'github', 'gpa', 'phoneCountryCode', 'pronouns'];
const CHOICE_KINDS = new Set(['select', 'radio', 'checkbox-group', 'checkbox']);

export function planFill(fields: DetectedField[], data: AutofillData, ctx: PlanContext): PlanItem[] {
  const items = fields.map((f) => planOne(f, data, ctx));
  // A separate country-code control means the phone box wants the national number only.
  const codeItem = items.find((i) => i.fieldType === 'phoneCountryCode');
  const code = resolveFieldValue('phoneCountryCode', data.profile, ctx);
  // …but only when that control will hold our code: a page default such as "India (+91)" is kept
  // (never overwritten silently), and then the number keeps its own +1.
  const digits = code.replace(/\D/g, '');
  const codeSet = codeItem && (codeItem.status === 'ready' || codeItem.status === 'review' || new RegExp(`\\+\\s*${digits}(?!\\d|-\\d)`).test(codeItem.currentValue));
  if (codeItem && code && codeSet) {
    for (const i of items) {
      if (i.fieldType === 'phone' && i.value.startsWith(code)) i.value = i.value.slice(code.length).replace(/^[\s.-]+/, '');
    }
  }
  return items;
}

/** "+1" matches both "Canada (+1)" and "United States (+1)": prefer the profile's country. */
function dialOption(options: FieldOption[], code: string, country: string): FieldOption | null {
  const re = new RegExp(`\\+\\s*${code.replace(/\D/g, '')}(?!\\d|-\\d)`);
  const hits = options.filter((o) => re.test(o.label) || re.test(o.value));
  const c = country.trim().toLowerCase();
  return hits.find((o) => c && o.label.toLowerCase().includes(c)) ?? hits[0] ?? null;
}

export function planOne(f: DetectedField, data: AutofillData, ctx: PlanContext): PlanItem {
  let fieldType = f.fieldType;
  let questionKey = f.questionKey;
  let source: PlanItem['source'] = 'none';
  const mapping = data.mappings.find((m) => m.host === ctx.host && m.signature === f.signature);
  if (mapping) {
    fieldType = mapping.fieldType as FieldType;
    questionKey = mapping.questionKey ?? (fieldType === 'question' ? questionKey : null);
    source = 'mapping';
  }
  const base: PlanItem = {
    fieldId: f.id,
    label: f.label || f.name || 'Unlabeled field',
    kind: f.kind,
    fieldType,
    status: 'skipped',
    value: '',
    source,
    confidence: f.confidence,
    note: '',
    question: f.question,
    questionKey,
    questionNormalized: f.questionNormalized,
    sensitive: f.sensitive,
    required: f.required,
    options: f.options,
    currentValue: f.currentValue,
    signature: f.signature,
    savedAnswerId: null,
  };

  if (f.kind === 'file') {
    return { ...base, status: fieldType === 'resume' || fieldType === 'coverLetter' ? 'file' : 'skipped', note: fieldType === 'coverLetter' ? 'Attach a cover letter yourself if needed.' : 'Attach the recommended resume version.' };
  }
  if (f.consent) {
    return { ...base, status: f.currentValue ? 'prefilled' : 'manual', note: 'Legal acknowledgement — review and check this yourself.' };
  }

  let value = '';
  let confidence = f.confidence;
  let exact = true;
  const contextual = f.contextual;
  if (questionKey) {
    const text = f.question || f.label;
    const byKey = data.answers.find((a) => a.questionKey === questionKey);
    const hit = byKey ? { answer: byKey, confidence: 0.97, exact: true } : findSavedAnswer(text, data.answers);
    if (hit) {
      value = hit.answer.answer;
      confidence = hit.confidence;
      exact = hit.exact;
      source = source === 'mapping' ? 'mapping' : 'saved';
      base.savedAnswerId = (hit.answer as { id?: string }).id ?? null;
    } else {
      const fromProfile = profileAnswerFor(questionKey, data.profile);
      if (fromProfile) {
        value = fromProfile;
        confidence = 0.9;
        source = source === 'mapping' ? 'mapping' : 'profile';
      }
    }
  } else if (fieldType !== 'question' && fieldType !== 'unknown') {
    value = resolveFieldValue(fieldType, data.profile, ctx);
    if (value) source = source === 'mapping' ? 'mapping' : 'profile';
  }

  // Already filled on the page: keep it (never overwrite user input silently).
  if (f.currentValue) {
    return { ...base, status: 'prefilled', value, confidence, note: value && norm(value) !== norm(f.currentValue) ? `Already filled ("${f.currentValue}"). Your saved value is "${value}".` : 'Already filled — kept as is.' };
  }

  if (!value) {
    if (fieldType === 'unknown' || (!f.required && OPTIONAL_STANDARD.includes(fieldType))) return { ...base, status: 'skipped', note: 'Nothing saved for this optional field.' };
    const isQuestion = !!questionKey;
    return { ...base, status: 'unknown', note: isQuestion ? "I don't have a saved answer for this question." : 'This information is not in your profile yet.' };
  }

  let display = value;
  let status: PlanStatus = 'ready';
  const notes: string[] = [];
  if (CHOICE_KINDS.has(f.kind) && f.kind !== 'checkbox') {
    if (f.options.length) {
      const opt = (fieldType === 'phoneCountryCode' && dialOption(f.options, value, data.profile.location.country)) || chooseOption(f.options, value);
      if (opt) display = opt.label;
      else {
        status = 'review';
        notes.push(`Your saved answer "${value}" doesn't match any option.`);
      }
    }
  }
  if (!exact) {
    status = 'review';
    notes.push(`Matched a similar saved question (${Math.round(confidence * 100)}% similar).`);
  }
  if (contextual && status === 'ready') {
    status = 'review';
    notes.push('This answer may depend on the specific job — please confirm.');
  }
  if (confidence < 0.75 && status === 'ready') {
    status = 'review';
    notes.push('Low-confidence field match — please confirm.');
  }
  return { ...base, status, value: display, source, confidence, note: notes.join(' ') };
}

function norm(s: string) {
  return s.trim().toLowerCase();
}

export function summarizePlan(items: PlanItem[]) {
  const visible = items.filter((i) => i.status !== 'skipped');
  return {
    detected: visible.length,
    fillable: items.filter((i) => i.status === 'ready' || (i.status === 'review' && i.value)).length,
    attention: items.filter((i) => i.status === 'review' || i.status === 'unknown' || (i.status === 'manual' && i.required)).length,
    unknown: items.filter((i) => i.status === 'unknown').length,
    prefilled: items.filter((i) => i.status === 'prefilled').length,
  };
}
