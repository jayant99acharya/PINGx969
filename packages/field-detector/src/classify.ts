import type { FieldType } from '@pingx969/shared';

export interface FieldSignals {
  label: string;
  name: string;
  id: string;
  placeholder: string;
  autocomplete: string;
  ariaDescription: string;
  context: string;
  automationId: string;
  inputType: string;
  tag: string;
}

interface Rule {
  type: FieldType;
  /** Matches against human-visible text (label, placeholder, context). */
  text?: RegExp;
  /** Matches against developer identifiers (name, id, data-automation-id). */
  ident?: RegExp;
  autocomplete?: string[];
  inputTypes?: string[];
  /** If the label matches this, the rule does not apply. */
  not?: RegExp;
  onlyTags?: string[];
}

const NOT_PERSON = /\b(company|employer|organi[sz]ation|school|university|reference|referrer|emergency|recruiter|manager|supervisor|file|user ?name|account|business|parent|guardian)\b/i;

export const RULES: Rule[] = [
  { type: 'email', autocomplete: ['email'], inputTypes: ['email'], text: /\be-?mail\b/i, ident: /e-?mail/i, not: /referr|reference|manager/i },
  { type: 'firstName', autocomplete: ['given-name'], text: /\b(first|given|fore)[\s-]*name\b|^first$/i, ident: /first[_\-. ]?name|\bfname\b|given[_-]?name|firstName|legalNameSection_firstName/i, not: NOT_PERSON },
  { type: 'lastName', autocomplete: ['family-name'], text: /\b(last|family|sur)[\s-]*name\b|\bsurname\b|^last$/i, ident: /last[_\-. ]?name|\blname\b|family[_-]?name|surname|lastName|legalNameSection_lastName/i, not: NOT_PERSON },
  { type: 'middleName', autocomplete: ['additional-name'], text: /\bmiddle[\s-]*(name|initial)\b/i, ident: /middle[_-]?name/i },
  { type: 'preferredName', autocomplete: ['nickname'], text: /\bpreferred[\s-]*(first[\s-]*)?name\b|\bnick[\s-]?name\b|\bgo by\b/i, ident: /preferred[_-]?name|nickname/i },
  { type: 'fullName', autocomplete: ['name'], text: /^(full |legal |your )?name$|^full[\s-]*(legal )?name|^(your )?(legal )?full name|^name\s*\(?first and last\)?/i, ident: /^(full_?name|fullname|name|candidate_?name|_systemfield_name|applicant_?name)$/i, not: NOT_PERSON },
  { type: 'pronouns', text: /\bpronouns?\b/i, ident: /pronoun/i },
  { type: 'phoneCountryCode', autocomplete: ['tel-country-code'], text: /\b(country|dialing|area)[\s-]*code\b|\b(country )?calling code\b|\bdial(l)?ing code\b/i, ident: /country[_-]?code|phone[_-]?code|dial/i },
  { type: 'phone', autocomplete: ['tel', 'tel-national'], inputTypes: ['tel'], text: /\b(phone|mobile|cell(ular)?|telephone|contact number)\b/i, ident: /phone|mobile|\btel\b|cell/i, not: /\b(type|extension|ext\.?|reference|referr|emergency|country code)\b/i },
  { type: 'address1', autocomplete: ['address-line1', 'street-address'], text: /\b(street|address( line)?\s*1|^address$|mailing address|home address|street address)\b/i, ident: /address[_-]?(line)?[_-]?1|street|addressLine1|^address$/i, not: /e-?mail|web|ip address|line 2/i },
  { type: 'address2', autocomplete: ['address-line2'], text: /\baddress( line)?\s*2\b|\b(apt|apartment|suite|unit)\b/i, ident: /address[_-]?(line)?[_-]?2|addressLine2/i },
  { type: 'city', autocomplete: ['address-level2'], text: /^city$|\bcity\b|\btown\b/i, ident: /\bcity\b|addressSection_city|locality/i, not: /\bcity,\s*state\b|\bwhich city\b.*\brelocat/i },
  { type: 'state', autocomplete: ['address-level1'], text: /^(state|province|region)\b|\bstate\s*\/\s*province\b|\bstate or province\b/i, ident: /\b(state|province|region)\b|addressSection_countryRegion/i, not: /statement|united states|status/i },
  { type: 'postalCode', autocomplete: ['postal-code'], text: /\b(zip|postal|post)[\s-]*(code)?\b/i, ident: /zip|postal|postcode/i },
  { type: 'country', autocomplete: ['country', 'country-name'], text: /^country( of residence)?$|\bcountry\b/i, ident: /\bcountry\b|countryDropdown/i, not: /code|authorized|citizen/i },
  { type: 'location', text: /^(current )?location$|\bcurrent location\b|where (are you|do you) (currently )?(based|located|live)|^city,?\s*state/i, ident: /^location$|candidate[_-]?location|_systemfield_location/i },
  { type: 'linkedin', text: /linked\s?in/i, ident: /linkedin/i },
  { type: 'github', text: /\bgit\s?hub\b/i, ident: /github/i },
  { type: 'portfolio', text: /\bportfolio\b/i, ident: /portfolio/i },
  { type: 'twitter', text: /\btwitter\b|\bx\.com\b/i, ident: /twitter/i },
  { type: 'website', autocomplete: ['url'], inputTypes: ['url'], text: /\b(website|personal (site|url|web)|homepage|blog|other (link|url|website))\b/i, ident: /website|homepage|personal[_-]?url|urls\[other\]/i },
  { type: 'currentCompany', autocomplete: ['organization'], text: /\b(current|present|most recent)\s+(company|employer)\b|^(company|employer)( name)?$|^organi[sz]ation$/i, ident: /current[_-]?company|employer|^org$|^company$/i, not: /previously|worked (for|at)|referr/i },
  { type: 'currentTitle', autocomplete: ['organization-title'], text: /\b(current|present|most recent)\s+(job\s+)?(title|position|role)\b|^(job )?title$/i, ident: /current[_-]?title|job[_-]?title|^title$/i },
  { type: 'yearsExperience', text: /\byears of (professional |relevant |work |total )?experience\b|\bhow many years\b|\btotal experience\b/i, ident: /years[_-]?(of[_-]?)?experience|yoe/i },
  { type: 'school', text: /\b(school|university|college|institution)( name)?\b/i, ident: /school|university|college|institution/i, not: /high school diploma|graduat(ed|ion) (year|date)/i },
  { type: 'degree', text: /^degree$|\bdegree( type| obtained| earned)?\b|\bhighest (level of )?education\b/i, ident: /degree/i },
  { type: 'fieldOfStudy', text: /\b(field of study|major|discipline|area of study|concentration)\b/i, ident: /major|field[_-]?of[_-]?study|discipline/i },
  { type: 'graduationYear', text: /\bgraduation (year|date)\b|\byear of graduation\b|\bgrad(uation)? year\b/i, ident: /grad(uation)?[_-]?(year|date)/i },
  { type: 'gpa', text: /\bgpa\b|\bgrade point\b/i, ident: /\bgpa\b/i },
  { type: 'desiredSalary', text: /\b(desired|expected|target)\s+(salary|compensation|pay)\b|\bsalary (expectation|requirement)s?\b|\bcompensation expectations?\b/i, ident: /salary|compensation/i },
  { type: 'noticePeriod', text: /\bnotice period\b/i, ident: /notice[_-]?period/i },
  { type: 'startDate', text: /\b(available )?start date\b|\bwhen can you start\b|\bearliest start\b|\bavailability date\b/i, ident: /start[_-]?date|availability/i, not: /\b(employment|job|role) (start|end)\b.*\bdate\b.*\b(previous|past)\b/i },
  { type: 'coverLetterText', text: /\bcover letter\b/i, ident: /cover[_-]?letter/i, onlyTags: ['textarea'] },
  { type: 'resume', text: /\b(resume|résumé|cv|curriculum vitae)\b/i, ident: /resume|\bcv\b|_systemfield_resume/i, inputTypes: ['file'] },
  { type: 'coverLetter', text: /\bcover letter\b/i, ident: /cover[_-]?letter/i, inputTypes: ['file'] },
];

const QUESTION_RE = /\?\s*$|^(are|do|did|will|would|have|has|is|can|could|please|what|why|how|when|which|describe|tell|explain|briefly|list)\b/i;

export interface Classification {
  type: FieldType;
  confidence: number;
  /** Label looks like a screening question (long or phrased as a question). */
  looksLikeQuestion: boolean;
}

export function classifySignals(s: FieldSignals): Classification {
  const human = [s.label, s.placeholder].filter(Boolean).join(' | ');
  const ident = [s.name, s.id, s.automationId].filter(Boolean).join(' ');
  const looksLikeQuestion = QUESTION_RE.test(s.label) || s.label.length > 60;
  let best: Classification = { type: 'unknown', confidence: 0, looksLikeQuestion };
  for (const r of RULES) {
    if (r.onlyTags && !r.onlyTags.includes(s.tag)) continue;
    if (r.inputTypes?.includes('file') && s.inputType !== 'file') continue;
    if (s.inputType === 'file' && !r.inputTypes?.includes('file')) continue;
    const notHit = r.not && (r.not.test(s.label) || r.not.test(s.placeholder));
    if (notHit) continue;
    let c = 0;
    if (r.autocomplete && s.autocomplete && r.autocomplete.includes(s.autocomplete.toLowerCase().split(/\s+/).pop()!)) c = Math.max(c, 0.97);
    if (r.text && s.label && r.text.test(s.label)) c = Math.max(c, looksLikeQuestion ? 0.7 : 0.92);
    if (r.text && s.placeholder && r.text.test(s.placeholder)) c = Math.max(c, 0.8);
    if (r.ident && ident && r.ident.test(ident)) c = Math.max(c, s.label ? 0.85 : 0.88);
    if (r.inputTypes && r.inputTypes.includes(s.inputType) && s.inputType !== 'file') c = Math.max(c, 0.75);
    if (!c && r.text && s.context && r.text.test(s.context) && s.context.length < 80) c = 0.6;
    if (r.inputTypes?.includes('file') && s.inputType === 'file' && !c && r.type === 'resume') c = 0.55; // first file input is usually the resume
    // agreement bonus
    if (c && r.text && r.ident && r.text.test(human) && r.ident.test(ident)) c = Math.min(0.99, Math.round((c + 0.04) * 100) / 100); // rounded: 0.92 + 0.04 must equal 0.96
    if (c > best.confidence) best = { type: r.type, confidence: c, looksLikeQuestion };
  }
  return best;
}

/** Legal checkboxes the extension must never tick automatically. */
export const CONSENT_RE = /\b(i agree|agree to|consent|acknowledge|certify|attest|terms( of service| and conditions)?|privacy (policy|notice)|i understand|i confirm|accept)\b/i;
