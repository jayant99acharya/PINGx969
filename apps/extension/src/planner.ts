import { type PlanItem, planFill, summarizePlan } from '@pingx969/field-detector';
import type { Bootstrap, ContentState, PageContext } from './messages';

export function makePlan(state: ContentState, data: Bootstrap): PlanItem[] {
  return planFill(state.fields, { profile: data.profile, answers: data.answers, mappings: data.mappings }, { host: state.host, company: state.job.company, title: state.job.title });
}

export { summarizePlan };

export function bestResume(ctx: PageContext | null): { versionId: string | null; resumeId: string | null; label: string; match: number | null } {
  if (ctx?.recommendedVersion) return { versionId: ctx.recommendedVersion.id, resumeId: null, label: ctx.recommendedVersion.label, match: ctx.recommendedVersion.matchAfter };
  if (ctx?.defaultResume) return { versionId: null, resumeId: ctx.defaultResume.id, label: `${ctx.defaultResume.name} (original)`, match: null };
  return { versionId: null, resumeId: null, label: '', match: null };
}

export const STATUS_ICON: Record<PlanItem['status'], string> = { ready: '✓', review: '⚠', unknown: '?', prefilled: '•', manual: '✋', file: '📎', skipped: '–' };
