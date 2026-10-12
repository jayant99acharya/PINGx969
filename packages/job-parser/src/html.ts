/** Dependency-free HTML -> text conversion for job pages fetched by URL. */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', bull: '•', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|head|nav|footer|iframe|template)\b[\s\S]*?<\/\1>/gi, ' ');
  s = s
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|ul|ol|h[1-6]|tr|table|header|blockquote)>/gi, '\n')
    .replace(/<(p|div|section|article|h[1-6]|tr|ul|ol)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter((l, i, arr) => l || (arr[i - 1] ?? '') !== '')
    .join('\n')
    // Bullet glyphs rendered on their own line ("•\nText") belong to the following line.
    .replace(/^([•·▪◦‣\-*])\s*\n+(?=\S)/gm, '$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface ExtractedPosting {
  title: string;
  company: string;
  location: string;
  text: string;
}

/** Prefer schema.org JobPosting JSON-LD (used by most ATS boards), else the page text. */
export function extractJobPostingFromHtml(html: string): ExtractedPosting {
  const scripts = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const sc of scripts) {
    const body = sc.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
    try {
      const parsed = JSON.parse(body) as unknown;
      const nodes: unknown[] = Array.isArray(parsed) ? parsed : [parsed, ...(((parsed as Record<string, unknown>)?.['@graph'] as unknown[]) ?? [])];
      for (const n of nodes) {
        const o = n as Record<string, unknown>;
        if (o && (o['@type'] === 'JobPosting' || (Array.isArray(o['@type']) && (o['@type'] as string[]).includes('JobPosting')))) {
          const org = (o.hiringOrganization ?? {}) as Record<string, unknown>;
          const loc = (Array.isArray(o.jobLocation) ? o.jobLocation[0] : o.jobLocation) as Record<string, unknown> | undefined;
          const addr = (loc?.address ?? {}) as Record<string, unknown>;
          return {
            title: String(o.title ?? ''),
            company: String(org.name ?? ''),
            location: [addr.addressLocality, addr.addressRegion].filter(Boolean).join(', '),
            text: htmlToText(decodeEntities(String(o.description ?? ''))),
          };
        }
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  }
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
  const main = html.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? html.match(/<body\b[\s\S]*<\/body>/i)?.[0] ?? html;
  return { title: decodeEntities(titleTag).trim(), company: '', location: '', text: htmlToText(main) };
}
