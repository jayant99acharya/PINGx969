/** Typed fetch wrapper: cookie session + CSRF header, consistent error objects. */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

let csrfToken = '';
export function setCsrf(t: string | undefined) {
  csrfToken = t ?? '';
}

type Listener = () => void;
const authListeners = new Set<Listener>();
export function onAuthLost(fn: Listener) {
  authListeners.add(fn);
  return () => {
    authListeners.delete(fn);
  };
}

async function handle<T>(res: Response): Promise<T> {
  if (res.ok) {
    const ct = res.headers.get('content-type') ?? '';
    return (ct.includes('application/json') ? await res.json() : await res.blob()) as T;
  }
  let code = 'http_error';
  let message = `Request failed (${res.status}).`;
  let details: unknown;
  try {
    const body = await res.json();
    code = body?.error?.code ?? code;
    message = body?.error?.message ?? message;
    details = body?.error?.details;
  } catch {
    if (res.status === 502 || res.status === 503 || res.status === 504) message = 'The server is unavailable. Please try again in a moment.';
  }
  if (res.status === 401) authListeners.forEach((l) => l());
  throw new ApiError(res.status, code, message, details);
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal } = {}): Promise<T> {
  const method = opts.method ?? (opts.body || opts.form ? 'POST' : 'GET');
  const headers: Record<string, string> = {};
  if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = csrfToken;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body, credentials: 'same-origin', signal: opts.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'network_error', 'Could not reach the server. Check your connection and that the API is running.');
  }
  return handle<T>(res);
}

/** Download a file from the API, surfacing JSON errors (e.g. unfilled placeholders). */
export async function download(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (!res.ok) await handle(res);
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = cd.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function fetchBlob(path: string): Promise<Blob> {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (!res.ok) await handle(res);
  return res.blob();
}

export const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
