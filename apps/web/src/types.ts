import type { ApplicationStatus, Change, JobAnalysis, LayoutProfile, MatchResult, ResumeData, ResumeFormat, ScoringWeights } from '@pingx969/shared';

export interface ResumeRow {
  id: string;
  name: string;
  sourceFormat: ResumeFormat;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  versionCount?: number;
}

export interface Capability {
  format: 'pdf' | 'docx' | 'json' | 'txt' | 'md';
  fidelity: 'original-patched' | 'layout-matched' | 'structured';
  note: string;
}

export interface ResumeDetail {
  resume: ResumeRow;
  data: ResumeData;
  layout: LayoutProfile;
  structure: Record<string, boolean | number>;
  warnings: string[];
  facts: { skills: string[]; years: number; highestDegree: string };
  capabilities: Capability[];
}

export interface JobRow {
  id: string;
  title: string;
  company: string;
  url: string;
  location: string;
  seniority: string;
  workArrangement: string;
  createdAt: string;
  versionCount?: number;
  bestMatch?: number | null;
  description?: { analysis: JobAnalysis; rawText: string } | null;
}

export interface VersionRow {
  id: string;
  resumeId: string;
  jobId: string | null;
  label: string;
  company: string;
  jobTitle: string;
  jobUrl: string;
  matchBefore: number;
  matchAfter: number;
  provider: string;
  createdAt: string;
  updatedAt: string;
}

export interface VersionPayload {
  changes: Change[];
  optimized: ResumeData;
  matchBefore: MatchResult;
  matchAfter: MatchResult;
  provider: string;
  warnings: string[];
  metadata: Record<string, unknown>;
}

export interface VersionDetail {
  version: VersionRow;
  payload: VersionPayload;
  original: ResumeData | null;
  resume: { id: string; name: string; sourceFormat: ResumeFormat } | null;
  job: { id: string; title: string; company: string; url: string; analysis: JobAnalysis | null } | null;
  capabilities: Capability[];
  placeholders: number;
}

export interface ApplicationRow {
  id: string;
  jobId: string | null;
  resumeVersionId: string | null;
  company: string;
  jobTitle: string;
  jobUrl: string;
  status: ApplicationStatus;
  matchScore: number | null;
  notes: string;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SavedAnswer {
  id: string;
  questionKey: string;
  rawQuestion: string;
  normalizedQuestion: string;
  answer: string;
  source: string;
  sensitive: boolean;
  useCount: number;
  updatedAt: string;
}

export interface SettingsResponse {
  settings: { scoringWeights: ScoringWeights; aiProvider: string; autoLearn: boolean; showLauncher: boolean };
  providers: { name: string; available: boolean; external: boolean; model: string | null; reason?: string }[];
  dimensions: { key: keyof ScoringWeights; label: string; description: string; defaultWeight: number }[];
}
