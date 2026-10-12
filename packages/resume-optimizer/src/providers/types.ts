import type { Change, DegreeLevel, JobAnalysis, JobInput, MatchResult, ParsedResume, ResumeData, Seniority } from '@pingx969/shared';
import type { QuestionMapping } from '@pingx969/profile';

export interface ResumeAnalysis {
  skills: string[];
  yearsExperience: number;
  highestDegree: DegreeLevel;
  titles: string[];
  domains: string[];
  seniority: Seniority;
  warnings: string[];
}

export interface OptimizationInput {
  resume: ResumeData;
  job: JobAnalysis;
  match: MatchResult;
  confirmedSkills: string[];
  yearsOverride?: number | null;
  /** 'skills' = only append job-relevant skills to the Skills section; 'full' = complete tailoring. */
  scope?: 'full' | 'skills';
}

export interface ProviderOptimization {
  changes: Change[];
  warnings: string[];
}

/** Pluggable AI layer. Implementations must not be trusted: all output is schema-validated and fact-guarded. */
export interface AIProvider {
  readonly name: string;
  /** True when calling this provider transmits data off this server. */
  readonly external: boolean;
  readonly model: string | null;
  analyzeJobDescription(input: JobInput): Promise<JobAnalysis>;
  analyzeResume(input: ParsedResume, opts?: { confirmedSkills?: string[] }): Promise<ResumeAnalysis>;
  optimizeResume(input: OptimizationInput): Promise<ProviderOptimization>;
  normalizeQuestion(input: string): Promise<QuestionMapping>;
}
