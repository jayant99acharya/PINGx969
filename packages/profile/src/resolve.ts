import { type FieldType, type Profile, type ResumeData, mergeProfile, totalMonths } from '@pingx969/shared';
import { countryCode } from './questions';

export interface JobContext {
  company?: string;
  title?: string;
}

function yearsFromProfile(p: Profile, now = new Date()): number | null {
  if (p.yearsOfExperienceOverride != null) return p.yearsOfExperienceOverride;
  const months = totalMonths(
    p.experience.map((e) => ({ start: e.startDate, end: e.current ? 'present' : e.endDate })),
    now,
  );
  return months ? Math.floor(months / 12) : null;
}

function currentJob(p: Profile) {
  return p.experience.find((e) => e.current) ?? p.experience[0];
}

const yn = (v: 'yes' | 'no' | 'unset') => (v === 'yes' ? 'Yes' : v === 'no' ? 'No' : '');

/** Value of a catalog question derived from structured profile data (null = unknown). */
export function profileAnswerFor(questionKey: string, p: Profile): string | null {
  const [base, arg] = questionKey.split(':');
  switch (base) {
    case 'work_authorization': {
      const list = p.workAuthorization.authorizedCountries.map((c) => countryCode(c) ?? c.toUpperCase());
      if (!list.length) return null;
      if (!arg || arg === 'ANY') return 'Yes';
      // A country that isn't listed is unknown, not "No": the person may simply not have recorded it.
      return list.includes(arg) ? 'Yes' : null;
    }
    case 'sponsorship_required':
      return yn(p.workAuthorization.requiresSponsorship) || null;
    case 'citizenship':
      return p.workAuthorization.citizenship || null;
    case 'security_clearance':
      return p.workAuthorization.securityClearance || null;
    case 'relocation':
      return yn(p.preferences.willingToRelocate) || null;
    case 'desired_salary':
      return p.preferences.desiredSalary || null;
    case 'notice_period':
      return p.preferences.noticePeriod || null;
    case 'start_date':
      return p.preferences.availableStartDate || null;
    case 'pronouns':
      return p.personal.pronouns || null;
    case 'eeo_gender':
      return p.eeo.gender || null;
    case 'eeo_race':
      return p.eeo.raceEthnicity || null;
    case 'eeo_hispanic':
      return p.eeo.hispanicLatino || null;
    case 'eeo_veteran':
      return p.eeo.veteranStatus || null;
    case 'eeo_disability':
      return p.eeo.disabilityStatus || null;
    case 'years_experience': {
      if (arg) return null; // skill-specific years can't be derived honestly
      const y = yearsFromProfile(p);
      return y != null ? String(y) : null;
    }
    case 'remote_preference':
      return p.preferences.remotePreference !== 'unset' ? p.preferences.remotePreference : null;
    default:
      return null;
  }
}

/** Value for a standard (non-question) field from the profile. Empty string = unknown. */
export function resolveFieldValue(type: FieldType, p: Profile, ctx: JobContext = {}): string {
  const job = currentJob(p);
  const edu = p.education[0];
  switch (type) {
    case 'firstName':
      return p.personal.firstName;
    case 'middleName':
      return p.personal.middleName;
    case 'lastName':
      return p.personal.lastName;
    case 'preferredName':
      return p.personal.preferredName || p.personal.firstName;
    case 'fullName':
      return [p.personal.firstName, p.personal.middleName, p.personal.lastName].filter(Boolean).join(' ');
    case 'pronouns':
      return p.personal.pronouns;
    case 'email':
      return p.personal.email;
    case 'phone':
      return p.personal.phone;
    case 'phoneCountryCode':
      return p.personal.phone.match(/^\+(\d{1,3})/)?.[1] ? `+${p.personal.phone.match(/^\+(\d{1,3})/)![1]}` : countryCode(p.location.country) === 'US' ? '+1' : '';
    case 'address1':
      return p.location.address1;
    case 'address2':
      return p.location.address2;
    case 'city':
      return p.location.city;
    case 'state':
      return p.location.state;
    case 'postalCode':
      return p.location.postalCode;
    case 'country':
      return p.location.country;
    case 'location':
      return [p.location.city, p.location.state, p.location.city && p.location.state ? '' : p.location.country].filter(Boolean).join(', ');
    case 'linkedin':
      return p.links.linkedin;
    case 'github':
      return p.links.github;
    case 'portfolio':
      return p.links.portfolio || p.links.website;
    case 'website':
      return p.links.website || p.links.portfolio;
    case 'twitter':
      return p.links.twitter;
    case 'currentCompany':
      return job?.company ?? '';
    case 'currentTitle':
      return job?.title ?? '';
    case 'yearsExperience': {
      const y = yearsFromProfile(p);
      return y != null ? String(y) : '';
    }
    case 'school':
      return edu?.school ?? '';
    case 'degree':
      return edu?.degree ?? '';
    case 'fieldOfStudy':
      return edu?.field ?? '';
    case 'graduationYear':
      return edu?.endDate?.match(/\d{4}/)?.[0] ?? '';
    case 'gpa':
      return edu?.gpa ?? '';
    case 'workAuthorization':
      return profileAnswerFor('work_authorization:US', p) ?? '';
    case 'sponsorship':
      return profileAnswerFor('sponsorship_required:US', p) ?? '';
    case 'desiredSalary':
      return p.preferences.desiredSalary;
    case 'noticePeriod':
      return p.preferences.noticePeriod;
    case 'startDate':
      return p.preferences.availableStartDate;
    case 'relocation':
      return yn(p.preferences.willingToRelocate);
    case 'gender':
      return p.eeo.gender;
    case 'raceEthnicity':
      return p.eeo.raceEthnicity;
    case 'hispanicLatino':
      return p.eeo.hispanicLatino;
    case 'veteranStatus':
      return p.eeo.veteranStatus;
    case 'disabilityStatus':
      return p.eeo.disabilityStatus;
    case 'skills':
      return p.skills.join(', ');
    case 'summary':
      return p.personal.headline;
    case 'coverLetterText':
      return p.documents.coverLetterTemplate
        .replace(/\{\{?\s*company\s*\}?\}/gi, ctx.company || 'your company')
        .replace(/\{\{?\s*(title|role|position)\s*\}?\}/gi, ctx.title || 'this role');
    default:
      return '';
  }
}

export const SENSITIVE_FIELD_TYPES: FieldType[] = ['gender', 'raceEthnicity', 'hispanicLatino', 'veteranStatus', 'disabilityStatus', 'desiredSalary', 'pronouns'];

/** Fill empty profile fields from a parsed resume (never overwrites user-entered values). */
export function profileFromResume(base: Profile, data: ResumeData): Profile {
  const p = structuredClone(base);
  const set = <T extends Record<string, unknown>>(obj: T, key: keyof T, val: unknown) => {
    if (!obj[key] && val) (obj as Record<string, unknown>)[key as string] = val;
  };
  set(p.personal, 'firstName', data.personal.firstName);
  set(p.personal, 'lastName', data.personal.lastName);
  set(p.personal, 'email', data.personal.email);
  set(p.personal, 'phone', data.personal.phone);
  set(p.personal, 'headline', data.personal.headline || data.experience[0]?.title);
  if (data.personal.location) {
    const [city, region] = data.personal.location.split(/,\s*/);
    set(p.location, 'city', city);
    set(p.location, 'state', region);
    if (region && /^[A-Z]{2}$/.test(region)) set(p.location, 'country', 'United States');
  }
  for (const l of data.links) {
    if (l.kind === 'linkedin') set(p.links, 'linkedin', l.url);
    else if (l.kind === 'github' && !/github\.com\/[^/]+\/[^/]+/.test(l.url)) set(p.links, 'github', l.url);
    else if (l.kind === 'portfolio' || l.kind === 'website') set(p.links, 'website', l.url);
  }
  if (!p.experience.length) {
    p.experience = data.experience.map((e) => ({
      company: e.company,
      title: e.title,
      location: e.location,
      startDate: e.startDate,
      endDate: e.endDate === 'present' ? '' : e.endDate,
      current: e.endDate === 'present',
      description: e.bullets.map((b) => `• ${b.text}`).join('\n'),
    }));
  }
  if (!p.education.length) {
    p.education = data.education.map((e) => ({ school: e.institution, degree: e.degree, field: e.field, startDate: e.startDate, endDate: e.endDate, gpa: e.gpa }));
  }
  const skills = new Set(p.skills.map((s) => s.toLowerCase()));
  for (const g of data.skills) for (const s of g.items) if (!skills.has(s.toLowerCase())) {
    skills.add(s.toLowerCase());
    p.skills.push(s);
  }
  return mergeProfile(p, {});
}
