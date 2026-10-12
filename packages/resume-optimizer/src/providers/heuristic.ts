import type { JobAnalysis, JobInput, ParsedResume } from '@pingx969/shared';
import { analyzeJob, inferSeniority } from '@pingx969/job-parser';
import { type QuestionMapping, normalizeQuestion } from '@pingx969/profile';
import { buildFactBase } from '../facts';
import { proposeBulletChanges, proposeSkillChanges, proposeSummary } from '../heuristic-optimizer';
import type { AIProvider, OptimizationInput, ProviderOptimization, ResumeAnalysis } from './types';

/** Local, deterministic provider. No data leaves the server. Always available. */
export class HeuristicProvider implements AIProvider {
  readonly name = 'heuristic';
  readonly external = false;
  readonly model = null;

  async analyzeJobDescription(input: JobInput): Promise<JobAnalysis> {
    return analyzeJob(input);
  }

  async analyzeResume(input: ParsedResume, opts: { confirmedSkills?: string[] } = {}): Promise<ResumeAnalysis> {
    const facts = buildFactBase(input.data, { confirmedSkills: opts.confirmedSkills });
    const years = Math.round((facts.months / 12) * 10) / 10;
    return {
      skills: [...facts.skills.keys()],
      yearsExperience: years,
      highestDegree: facts.highestDegree,
      titles: facts.titles,
      domains: [...facts.domains.keys()],
      seniority: inferSeniority(facts.titles[0] ?? '', years),
      warnings: input.document.warnings,
    };
  }

  async optimizeResume(input: OptimizationInput): Promise<ProviderOptimization> {
    const facts = buildFactBase(input.resume, { confirmedSkills: input.confirmedSkills, yearsOverride: input.yearsOverride });
    if (input.scope === 'skills') {
      // Leave everything as written; only append skills (the original order is kept).
      return { changes: proposeSkillChanges(input.resume, input.job, facts, input.match, { reorder: false, appendToLast: true }), warnings: [] };
    }
    const changes = [
      ...proposeSkillChanges(input.resume, input.job, facts, input.match),
      ...proposeBulletChanges(input.resume, input.job, facts),
    ];
    const summary = proposeSummary(input.resume, input.job, facts);
    if (summary) changes.unshift(summary);
    return { changes, warnings: [] };
  }

  async normalizeQuestion(input: string): Promise<QuestionMapping> {
    return normalizeQuestion(input);
  }
}
