import { z } from 'zod';

const s = (max = 500) => z.string().max(max).default('');

export const ProfileExperienceSchema = z.object({
  company: s(200),
  title: s(200),
  location: s(200),
  startDate: s(20),
  endDate: s(20),
  current: z.boolean().default(false),
  description: s(4000),
});
export type ProfileExperience = z.infer<typeof ProfileExperienceSchema>;

export const ProfileEducationSchema = z.object({
  school: s(200),
  degree: s(200),
  field: s(200),
  startDate: s(20),
  endDate: s(20),
  gpa: s(20),
});
export type ProfileEducation = z.infer<typeof ProfileEducationSchema>;

export const TriStateSchema = z.enum(['yes', 'no', 'unset']).default('unset');

export const ProfileSchema = z.object({
  personal: z.object({
    firstName: s(100),
    middleName: s(100),
    lastName: s(100),
    preferredName: s(100),
    pronouns: s(50),
    email: s(254),
    phone: s(50),
    headline: s(300),
  }),
  location: z.object({
    address1: s(300),
    address2: s(300),
    city: s(120),
    state: s(120),
    postalCode: s(20),
    country: s(120),
  }),
  links: z.object({
    linkedin: s(500),
    github: s(500),
    portfolio: s(500),
    website: s(500),
    twitter: s(500),
    other: z.array(z.object({ label: s(100), url: s(500) })).default([]),
  }),
  experience: z.array(ProfileExperienceSchema).max(50).default([]),
  education: z.array(ProfileEducationSchema).max(20).default([]),
  skills: z.array(z.string().max(100)).max(300).default([]),
  /** Skills the user explicitly confirmed (optimizer may use these even if not in the resume). */
  confirmedSkills: z.array(z.string().max(100)).max(300).default([]),
  yearsOfExperienceOverride: z.number().min(0).max(70).nullable().default(null),
  workAuthorization: z.object({
    /** ISO-ish country names/codes the user is authorized to work in, e.g. ["United States"]. */
    authorizedCountries: z.array(z.string().max(100)).default([]),
    requiresSponsorship: TriStateSchema,
    citizenship: s(120),
    visaStatus: s(120),
    securityClearance: s(120),
  }),
  preferences: z.object({
    desiredSalary: s(100),
    salaryCurrency: s(10),
    noticePeriod: s(100),
    availableStartDate: s(50),
    willingToRelocate: TriStateSchema,
    remotePreference: z.enum(['remote', 'hybrid', 'onsite', 'any', 'unset']).default('unset'),
    preferredLocations: z.array(z.string().max(120)).default([]),
  }),
  eeo: z.object({
    gender: s(100),
    raceEthnicity: s(200),
    hispanicLatino: s(50),
    veteranStatus: s(200),
    disabilityStatus: s(200),
  }),
  documents: z.object({
    defaultResumeId: z.string().nullable().default(null),
    coverLetterTemplate: s(10000),
  }),
});
export type Profile = z.infer<typeof ProfileSchema>;

export function emptyProfile(): Profile {
  return ProfileSchema.parse({
    personal: {},
    location: {},
    links: {},
    workAuthorization: {},
    preferences: {},
    eeo: {},
    documents: {},
  });
}

/** Deep-merge a partial profile onto a full one (arrays replace). */
export function mergeProfile(base: Profile, patch: unknown): Profile {
  const merged = deepMerge(structuredClone(base) as unknown as Record<string, unknown>, patch);
  return ProfileSchema.parse(merged);
}

function deepMerge(target: Record<string, unknown>, patch: unknown): Record<string, unknown> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return target;
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    const cur = target[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
      target[k] = deepMerge(cur as Record<string, unknown>, v);
    } else {
      target[k] = v;
    }
  }
  return target;
}
