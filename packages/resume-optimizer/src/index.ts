import { AppError, type Change, ChangeSchema, ErrorCodes, type JobAnalysis, type JobInput } from '@pingx969/shared';
import { buildFactBase } from './facts';
import { guardChange } from './fact-guard';
import { AnthropicProvider, type AnthropicProviderConfig } from './providers/anthropic';
import { HeuristicProvider } from './providers/heuristic';
import type { AIProvider, OptimizationInput } from './providers/types';

export * from './facts';
export * from './match';
export * from './fact-guard';
export * from './apply';
export * from './heuristic-optimizer';
export * from './providers/types';
export { HeuristicProvider } from './providers/heuristic';
export { AnthropicProvider, redactForAI } from './providers/anthropic';

export interface ProviderConfig {
  provider?: string; // 'heuristic' | 'anthropic'
  anthropic?: AnthropicProviderConfig;
}

export function createProvider(cfg: ProviderConfig): AIProvider {
  if (cfg.provider === 'anthropic') {
    if (!cfg.anthropic?.apiKey) throw new AppError(ErrorCodes.AI_FAILURE, 'AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY on the server.', 500);
    return new AnthropicProvider(cfg.anthropic);
  }
  return new HeuristicProvider();
}

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, reject) => {
      t = setTimeout(() => reject(new AppError(ErrorCodes.AI_FAILURE, `${what} timed out.`, 504)), ms);
    }),
  ]);
}

export interface OptimizationOutcome {
  changes: Change[];
  provider: string;
  warnings: string[];
  fellBack: boolean;
}

/**
 * Run the provider, schema-validate every change, apply the fact guard, and fall back to the
 * local optimizer if the provider fails or times out. Never throws for provider failures.
 */
export async function runOptimization(provider: AIProvider, input: OptimizationInput, opts: { timeoutMs?: number } = {}): Promise<OptimizationOutcome> {
  const facts = buildFactBase(input.resume, { confirmedSkills: input.confirmedSkills, yearsOverride: input.yearsOverride });
  const warnings: string[] = [];
  let raw: Change[];
  let used = provider.name;
  let fellBack = false;
  try {
    const out = await withTimeout(provider.optimizeResume(input), opts.timeoutMs ?? 90_000, 'Resume optimization');
    raw = out.changes;
    warnings.push(...out.warnings);
  } catch (e) {
    if (provider.name === 'heuristic') throw e;
    const msg = e instanceof AppError ? e.message : 'unexpected error';
    warnings.push(`The AI provider failed (${msg}). The built-in optimizer was used instead.`);
    raw = (await new HeuristicProvider().optimizeResume(input)).changes;
    used = 'heuristic';
    fellBack = true;
  }
  const changes: Change[] = [];
  let invalid = 0;
  for (const c of raw) {
    const parsed = ChangeSchema.safeParse(c);
    if (!parsed.success) {
      invalid++;
      continue;
    }
    changes.push(guardChange(parsed.data, facts));
  }
  if (invalid) warnings.push(`${invalid} proposed change(s) had an invalid structure and were discarded.`);
  const blocked = changes.filter((c) => c.blocked).length;
  if (blocked) warnings.push(`${blocked} proposed change(s) were blocked because they were not supported by your resume.`);
  return { changes, provider: used, warnings, fellBack };
}

export async function analyzeJobWithProvider(provider: AIProvider, input: JobInput): Promise<{ analysis: JobAnalysis; warnings: string[] }> {
  try {
    return { analysis: await withTimeout(provider.analyzeJobDescription(input), 60_000, 'Job analysis'), warnings: [] };
  } catch (e) {
    if (provider.name === 'heuristic') throw e;
    // Empty JD etc. are user errors, not provider errors
    if (e instanceof AppError && e.code === ErrorCodes.EMPTY_JOB) throw e;
    const analysis = await new HeuristicProvider().analyzeJobDescription(input);
    return { analysis, warnings: [`The AI provider failed (${e instanceof AppError ? e.message : 'error'}); the built-in job analyzer was used.`] };
  }
}

