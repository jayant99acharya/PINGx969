import { PARSER_VERSION, parseResume } from '@pingx969/resume-parser';
import type { AppContext } from '../context';

/**
 * Load a resume, transparently re-parsing it from the original upload when it was parsed by an
 * older parser version (so improvements apply to resumes uploaded before them).
 */
export async function loadResume(ctx: AppContext, userId: string, id: string) {
  const resume = await ctx.repos.getResume(userId, id);
  if (!resume) return null;
  if ((resume.parsed.parserVersion ?? 1) >= PARSER_VERSION || !resume.sourceDocumentId) return resume;
  try {
    const doc = await ctx.repos.getDocument(userId, resume.sourceDocumentId);
    if (!doc) return resume;
    const parsed = await parseResume(new Uint8Array(await ctx.store.get(doc.storageKey)), doc.filename);
    await ctx.repos.updateResumeParsed(userId, id, parsed);
    return { ...resume, parsed };
  } catch {
    return resume; // keep the previous parse if re-parsing fails
  }
}
