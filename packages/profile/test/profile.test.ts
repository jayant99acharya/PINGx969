import { describe, expect, it } from 'vitest';
import { emptyProfile, mergeProfile, type ResumeData, ResumeDataSchema } from '@pingx969/shared';
import { answerPolarity, chooseOption, findSavedAnswer, normalizeQuestion, profileAnswerFor, profileFromResume, questionSimilarity, resolveFieldValue } from '../src';

describe('question normalization', () => {
  it.each([
    ['Are you legally authorized to work in the US?', 'Do you currently have authorization to work in the United States?'],
    ['Are you eligible to work in the United States of America?', 'Are you legally permitted to work in the U.S.? *'],
    ['Will you now or in the future require sponsorship for employment visa status (e.g. H-1B)?', 'Do you require visa sponsorship?'],
    ['What are your salary expectations?', 'Desired compensation'],
    ['How did you hear about us?', 'Where did you hear about this position?'],
    ['Gender', 'What is your gender?'],
  ])('maps equivalent questions to the same key: "%s" ≡ "%s"', (a, b) => {
    const ka = normalizeQuestion(a).key.replace(/:US$|:ANY$/, '');
    const kb = normalizeQuestion(b).key.replace(/:US$|:ANY$/, '');
    expect(ka).toBe(kb);
  });

  it('keeps authorization and sponsorship apart, and countries apart', () => {
    expect(normalizeQuestion('Are you authorized to work in the US without sponsorship?').key).toBe('work_authorization:US');
    expect(normalizeQuestion('Will you require sponsorship to work in the US?').key).toBe('sponsorship_required:US');
    expect(normalizeQuestion('Are you authorized to work in Canada?').key).toBe('work_authorization:CA');
    expect(normalizeQuestion('Can you tell us about yourself?').key).not.toMatch(/US$/); // pronoun "us" ≠ country
  });

  it('marks sensitive and contextual questions', () => {
    expect(normalizeQuestion('Do you identify as Hispanic or Latino?')).toMatchObject({ key: 'eeo_hispanic', sensitive: true });
    expect(normalizeQuestion('Are you willing to relocate to Austin?')).toMatchObject({ key: 'relocation', contextual: true });
    expect(normalizeQuestion('Have you ever worked for Acme before?')).toMatchObject({ key: 'previously_employed', contextual: true });
  });

  it('matches custom questions by similarity and never guesses unrelated ones', () => {
    const saved = [{ questionKey: normalizeQuestion('Do you have experience working in a regulated industry such as finance or healthcare?').key, rawQuestion: 'Do you have experience working in a regulated industry such as finance or healthcare?', normalizedQuestion: '', answer: 'Yes, healthcare.' }];
    expect(findSavedAnswer('Have you worked in a regulated industry (e.g. finance, healthcare)?', saved)?.answer.answer).toBe('Yes, healthcare.');
    expect(findSavedAnswer('Why do you want to work at Initech?', saved)).toBeNull();
    expect(questionSimilarity('What is your favorite programming language?', 'Which programming language do you like most?')).toBeGreaterThan(0.3);
  });

  it('suggests (but flags) a country-specific answer for a country-less question', () => {
    const saved = [{ questionKey: 'sponsorship_required:US', rawQuestion: 'Do you need sponsorship in the US?', normalizedQuestion: '', answer: 'No' }];
    const hit = findSavedAnswer('Will you require visa sponsorship?', saved)!;
    expect(hit).toMatchObject({ exact: false, confidence: 0.7 });
  });
});

describe('option matching', () => {
  const yn = [{ label: '--', value: '' }, { label: 'Yes', value: '1' }, { label: 'No', value: '0' }];
  it.each([
    ['Yes', 'Yes'],
    ['yes, I am', 'Yes'],
    ['No', 'No'],
    ["I don't", 'No'],
  ])('%s -> %s', (answer, label) => expect(chooseOption(yn, answer)?.label).toBe(label));

  it('handles verbose, synonym and range options', () => {
    const auth = [{ label: 'Yes, I am authorized to work in the US', value: 'a' }, { label: 'No, I will need sponsorship', value: 'b' }];
    expect(chooseOption(auth, 'Yes')?.value).toBe('a');
    const eeo = [{ label: 'Male', value: '1' }, { label: 'Female', value: '2' }, { label: 'Decline To Self Identify', value: '3' }];
    expect(chooseOption(eeo, 'Prefer not to say')?.value).toBe('3');
    const states = [{ label: 'California', value: 'CA' }, { label: 'Washington', value: 'WA' }];
    expect(chooseOption(states, 'WA')?.label).toBe('Washington');
    const countries = [{ label: 'Canada', value: 'ca' }, { label: 'United States of America', value: 'usa' }];
    expect(chooseOption(countries, 'United States')?.value).toBe('usa');
    const years = [{ label: '0-2 years', value: 'a' }, { label: '3-5 years', value: 'b' }, { label: '6+ years', value: 'c' }];
    expect(chooseOption(years, '8')?.value).toBe('c');
    expect(chooseOption(yn, 'Maybe later')).toBeNull();
  });

  it('reads yes/no polarity', () => {
    expect(answerPolarity('I am not')).toBe('no');
    expect(answerPolarity('Yes.')).toBe('yes');
    expect(answerPolarity('Blue')).toBeNull();
  });
});

describe('profile mapping', () => {
  const profile = mergeProfile(emptyProfile(), {
    personal: { firstName: 'Ana', middleName: 'M', lastName: 'Lopez', email: 'ana@example.com', phone: '+44 20 7946 0958' },
    location: { city: 'London', state: '', country: 'United Kingdom' },
    experience: [{ company: 'Old Co', title: 'Dev', startDate: '2015-01', endDate: '2018-01' }, { company: 'Now Co', title: 'Lead Dev', startDate: '2018-02', current: true }],
    education: [{ school: 'UCL', degree: 'MSc', field: 'Computer Science', endDate: '2014' }],
    workAuthorization: { authorizedCountries: ['United Kingdom'], requiresSponsorship: 'yes' },
    documents: { coverLetterTemplate: 'Dear {{company}} team, I am excited about the {{title}} role.' },
    yearsOfExperienceOverride: 11,
  });
  it('resolves standard fields', () => {
    expect(resolveFieldValue('fullName', profile)).toBe('Ana M Lopez');
    expect(resolveFieldValue('currentCompany', profile)).toBe('Now Co');
    expect(resolveFieldValue('yearsExperience', profile)).toBe('11');
    expect(resolveFieldValue('graduationYear', profile)).toBe('2014');
    expect(resolveFieldValue('location', profile)).toBe('London, United Kingdom');
    expect(resolveFieldValue('phoneCountryCode', profile)).toBe('+44');
    expect(resolveFieldValue('coverLetterText', profile, { company: 'Initech', title: 'SRE' })).toBe('Dear Initech team, I am excited about the SRE role.');
  });
  it('answers catalog questions from structured data only when known', () => {
    expect(profileAnswerFor('work_authorization:US', profile)).toBeNull(); // not listed ≠ not authorized: ask, don't answer "No"
    expect(profileAnswerFor('work_authorization:UK', profile)).toBe('Yes');
    expect(profileAnswerFor('sponsorship_required:US', profile)).toBe('Yes');
    expect(profileAnswerFor('eeo_gender', profile)).toBeNull();
    expect(profileAnswerFor('years_experience:kubernetes', profile)).toBeNull(); // never invent per-skill years
  });
  it('imports a resume into empty profile fields without overwriting', () => {
    const data: ResumeData = ResumeDataSchema.parse({
      personal: { name: 'Ana Lopez', firstName: 'Ana', lastName: 'Lopez', email: 'resume@example.com', phone: '123', location: 'Austin, TX' },
      summary: {},
      links: [{ kind: 'linkedin', url: 'https://linkedin.com/in/ana' }],
      skills: [{ id: 's', items: ['Go', 'Rust'] }],
    });
    const p = profileFromResume(mergeProfile(emptyProfile(), { personal: { email: 'account@example.com' } }), data);
    expect(p.personal.email).toBe('account@example.com');
    expect(p.personal.phone).toBe('123');
    expect(p.location).toMatchObject({ city: 'Austin', state: 'TX', country: 'United States' });
    expect(p.links.linkedin).toBe('https://linkedin.com/in/ana');
    expect(p.skills).toEqual(['Go', 'Rust']);
  });
});
