import { pickAdapter } from './adapters';
import { textOf } from './dom';

export interface PageJobInfo {
  url: string;
  title: string;
  company: string;
  description: string;
  source: 'jsonld' | 'adapter' | 'heuristic';
}

/** Extract job title/company/description from an application page (best effort, never throws). */
export function extractJobInfo(doc: Document, url = doc.location?.href ?? ''): PageJobInfo {
  const out: PageJobInfo = { url, title: '', company: '', description: '', source: 'heuristic' };
  try {
    for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
      const data = JSON.parse(s.textContent || 'null') as unknown;
      const nodes = Array.isArray(data) ? data : [data, ...(((data as Record<string, unknown>)?.['@graph'] as unknown[]) ?? [])];
      const posting = nodes.find((n) => (n as Record<string, unknown>)?.['@type'] === 'JobPosting') as Record<string, unknown> | undefined;
      if (posting) {
        out.title = String(posting.title ?? '');
        out.company = String((posting.hiringOrganization as Record<string, unknown>)?.name ?? '');
        // Inert parse: DOMParser documents never load resources or run handlers.
        const inert = new (doc.defaultView ?? globalThis).DOMParser().parseFromString(String(posting.description ?? ''), 'text/html');
        out.description = inert.body?.textContent?.trim() ?? '';
        out.source = 'jsonld';
      }
    }
  } catch {
    /* malformed JSON-LD */
  }
  const adapter = pickAdapter(url, doc);
  const ai = adapter.jobInfo?.(doc);
  if (ai) {
    out.title ||= ai.title?.trim() ?? '';
    out.company ||= ai.company?.trim() ?? '';
    if (out.source === 'heuristic' && (ai.title || ai.company)) out.source = 'adapter';
  }
  const meta = (n: string) => doc.querySelector(`meta[property="${n}"], meta[name="${n}"]`)?.getAttribute('content')?.trim() ?? '';
  if (!out.title || !out.company) {
    const t = doc.title || meta('og:title');
    const at = t.match(/^(?:job application for\s+)?(.+?)\s+(?:at|@)\s+(.+?)(?:\s*[|–-].*)?$/i);
    const dash = t.match(/^(.+?)\s+[|–-]\s+(.+)$/);
    if (at) {
      out.title ||= at[1].trim();
      out.company ||= at[2].trim();
    } else if (dash) {
      out.title ||= dash[1].trim();
      out.company ||= dash[2].trim();
    }
    out.company ||= meta('og:site_name');
    out.title ||= textOf(doc.querySelector('h1'));
  }
  if (!out.description) {
    // Largest text block that is not the form itself.
    const candidates = Array.from(doc.querySelectorAll('[class*="description" i], [id*="description" i], [class*="job" i] section, article, main, #content')).filter(
      (el) => !el.querySelector('input, select, textarea') && !el.closest('[data-px-ui]'),
    );
    const best = candidates.map((el) => ({ el, len: (el.textContent ?? '').trim().length })).sort((a, b) => b.len - a.len)[0];
    if (best && best.len > 200) out.description = (best.el as HTMLElement).innerText?.trim() || best.el.textContent!.trim();
  }
  out.description = out.description.slice(0, 30_000);
  out.title = out.title.slice(0, 300);
  out.company = out.company.slice(0, 300);
  return out;
}
