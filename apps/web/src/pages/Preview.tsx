import { useEffect, useRef, useState } from 'react';
import { fetchBlob } from '../api';
import { ErrorBox, Loading } from '../ui';

/** Scale rendered Word pages down so a whole page fits the preview column (no clipping). */
function fitPages(host: HTMLElement) {
  const wrapper = host.querySelector<HTMLElement>('.docx-wrapper');
  const page = host.querySelector<HTMLElement>('section.docx');
  if (!wrapper || !page || !page.offsetWidth || host.clientWidth < 100) return;
  const scale = Math.min(1, (host.clientWidth - 32) / page.offsetWidth);
  wrapper.style.zoom = String(scale);
}

/**
 * Faithful preview of a document returned by the API:
 *  - PDF → the browser's PDF viewer (blob URL)
 *  - DOCX → rendered with docx-preview (Word layout, fonts, numbering)
 *  - text → monospace
 */
export function DocPreview({ path, kind, title }: { path: string; kind: 'pdf' | 'docx' | 'text'; title: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const blob = await fetchBlob(path);
        if (!alive) return;
        if (kind === 'pdf') {
          objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
          setUrl(objectUrl);
        } else if (kind === 'docx') {
          const { renderAsync } = await import('docx-preview');
          if (host.current) {
            host.current.innerHTML = '';
            await renderAsync(blob, host.current, undefined, { inWrapper: true, ignoreLastRenderedPageBreak: true, breakPages: true, experimental: true, useBase64URL: true });
            fitPages(host.current);
          }
        } else setText(await blob.text());
      } catch (e) {
        if (alive) setError(e);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, kind]);

  return (
    <div>
      {loading && <Loading text="Rendering preview…" />}
      <ErrorBox error={error} />
      {kind === 'pdf' && url && <iframe className="preview-frame" src={url} title={title} />}
      {kind === 'docx' && <div ref={host} className="docx-host" aria-label={title} style={{ visibility: loading || error ? 'hidden' : undefined }} />}
      {kind === 'text' && text !== null && <pre className="text-preview">{text}</pre>}
    </div>
  );
}
