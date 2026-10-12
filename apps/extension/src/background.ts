/**
 * Background service worker: the only extension context that holds the API token and talks
 * to the server. Content scripts and extension pages ask it for data via typed messages.
 * Messages are accepted only from this extension (sender.id check); pages can't reach it.
 */
import type { BgRequest, Bootstrap, ContentRequest, PageContext, Res } from './messages';

const DEFAULT_API = 'http://localhost:4000';
const CACHE_TTL_MS = 15_000;

interface Auth {
  apiUrl: string;
  token: string | null;
  email: string | null;
  expiresAt: string | null;
}

async function getAuth(): Promise<Auth> {
  const s = await chrome.storage.local.get(['apiUrl', 'token', 'email', 'expiresAt']);
  return { apiUrl: (s.apiUrl as string) || DEFAULT_API, token: (s.token as string) || null, email: (s.email as string) || null, expiresAt: (s.expiresAt as string) || null };
}

class ApiFailure extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: { method?: string; body?: unknown; raw?: boolean } = {}): Promise<T> {
  const auth = await getAuth();
  if (!auth.token) throw new ApiFailure('Sign in to PINGx969 in the extension options.', 'unauthorized', 401);
  let res: Response;
  try {
    res = await fetch(`${auth.apiUrl}/api${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: { Authorization: `Bearer ${auth.token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      credentials: 'omit',
    });
  } catch {
    throw new ApiFailure(`Can't reach the PINGx969 server at ${auth.apiUrl}. Is it running?`, 'network_error', 0);
  }
  if (res.status === 401) {
    const body = await res.json().catch(() => null);
    await chrome.storage.local.remove(['token']);
    await chrome.storage.session.remove(['bootstrap']);
    throw new ApiFailure(body?.error?.message ?? 'Your session expired. Sign in again from the extension options.', body?.error?.code ?? 'session_expired', 401);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiFailure(body?.error?.message ?? `Server error (${res.status})`, body?.error?.code ?? 'http_error', res.status);
  }
  if (init.raw) return res as unknown as T;
  return (await res.json()) as T;
}

async function bootstrap(force = false): Promise<Bootstrap> {
  const cached = await chrome.storage.session.get(['bootstrap', 'bootstrapAt']);
  if (!force && cached.bootstrap && Date.now() - Number(cached.bootstrapAt) < CACHE_TTL_MS) return cached.bootstrap as Bootstrap;
  const data = await call<Bootstrap>('/autofill/bootstrap');
  // Session storage is memory-only and never written to disk.
  await chrome.storage.session.set({ bootstrap: data, bootstrapAt: Date.now() });
  return data;
}

async function invalidate() {
  await chrome.storage.session.remove(['bootstrap', 'bootstrapAt']);
}

// ---------------------------------------------------------------- offline queue for learned answers
interface QueuedWrite {
  path: string;
  body: unknown;
  method: string;
  at: number;
}
async function enqueue(w: QueuedWrite) {
  const { queue = [] } = await chrome.storage.local.get('queue');
  (queue as QueuedWrite[]).push(w);
  await chrome.storage.local.set({ queue: (queue as QueuedWrite[]).slice(-100) });
}
async function flushQueue() {
  const { queue = [] } = await chrome.storage.local.get('queue');
  const remaining: QueuedWrite[] = [];
  for (const w of queue as QueuedWrite[]) {
    try {
      await call(w.path, { method: w.method, body: w.body });
    } catch (e) {
      if (e instanceof ApiFailure && (e.status === 0 || e.status >= 500)) remaining.push(w);
    }
  }
  await chrome.storage.local.set({ queue: remaining });
  if ((queue as QueuedWrite[]).length !== remaining.length) await invalidate();
}
chrome.alarms.create('flush-queue', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'flush-queue') void flushQueue();
});

async function writeOrQueue(path: string, body: unknown, method = 'POST') {
  try {
    const r = await call(path, { method, body });
    await invalidate();
    return { saved: true, queued: false, result: r };
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 0) {
      await enqueue({ path, body, method, at: Date.now() });
      return { saved: false, queued: true, result: null };
    }
    throw e;
  }
}

// ---------------------------------------------------------------- content/panel channels
interface Channel {
  tabId: number;
  frameId: number;
  url: string;
}
async function channels(): Promise<Record<string, Channel>> {
  return ((await chrome.storage.session.get('channels')).channels as Record<string, Channel>) ?? {};
}

function b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const CONTENT_FILES = ['content.js'];
const PAGE_READY_FILES = ['page-ready.js'];

async function handle(msg: BgRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (msg.type) {
    case 'auth/status': {
      const a = await getAuth();
      if (!a.token) return { signedIn: false, apiUrl: a.apiUrl, email: a.email };
      try {
        const b = await bootstrap();
        return { signedIn: true, apiUrl: a.apiUrl, email: b.user?.email ?? a.email, name: b.user?.displayName ?? '' };
      } catch (e) {
        if (e instanceof ApiFailure && e.status === 401) return { signedIn: false, apiUrl: a.apiUrl, email: a.email, expired: true };
        return { signedIn: true, apiUrl: a.apiUrl, email: a.email, offline: true, error: (e as Error).message };
      }
    }
    case 'auth/login': {
      const apiUrl = msg.apiUrl.replace(/\/+$/, '') || DEFAULT_API;
      const u = new URL(apiUrl);
      if (!/^https?:$/.test(u.protocol)) throw new ApiFailure('The server URL must start with http:// or https://', 'validation_error', 400);
      if (!['localhost', '127.0.0.1'].includes(u.hostname) && u.protocol !== 'https:') throw new ApiFailure('Remote servers must use https://', 'validation_error', 400);
      let res: Response;
      try {
        res = await fetch(`${apiUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: msg.email, password: msg.password, client: 'extension' }), credentials: 'omit' });
      } catch {
        throw new ApiFailure(`Can't reach ${apiUrl}. Check the server URL and that the server is running.`, 'network_error', 0);
      }
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new ApiFailure(body?.error?.message ?? 'Sign-in failed.', body?.error?.code ?? 'unauthorized', res.status);
      // Never store the password; only the revocable, expiring extension token.
      await chrome.storage.local.set({ apiUrl, token: body.token, email: body.user.email, expiresAt: body.expiresAt });
      await invalidate();
      return { signedIn: true, email: body.user.email };
    }
    case 'auth/logout': {
      const a = await getAuth();
      if (a.token) await call('/auth/logout', { method: 'POST' }).catch(() => undefined);
      await chrome.storage.local.remove(['token', 'expiresAt']);
      await chrome.storage.session.clear();
      return { signedIn: false };
    }
    case 'data/bootstrap':
      return bootstrap(!!msg.force);
    case 'page/context':
      return call<PageContext>('/autofill/page', { body: { url: msg.url, title: msg.title, company: msg.company } });
    case 'answers/save':
      return writeOrQueue('/answers', { question: msg.question, answer: msg.answer, source: msg.source, questionKey: msg.questionKey ?? undefined });
    case 'answers/used':
      await call('/answers/used', { body: { keys: msg.keys } }).catch(() => undefined);
      return { ok: true };
    case 'mappings/save':
      return writeOrQueue('/field-mappings', { host: msg.host, signature: msg.signature, label: msg.label, fieldType: msg.fieldType, questionKey: msg.questionKey });
    case 'profile/learn':
      return writeOrQueue('/profile', msg.patch, 'PATCH');
    case 'settings/update': {
      const r = await call('/settings', { method: 'PUT', body: msg.patch });
      await invalidate();
      return r;
    }
    case 'application/upsert': {
      const { type: _t, ...body } = msg;
      void _t;
      return call('/applications/upsert', { body });
    }
    case 'application/submitPending': {
      if (!sender.tab?.id) return { ok: false };
      const key = `pending:${sender.tab.id}`;
      await chrome.storage.session.set({ [key]: { url: msg.url, company: msg.company, jobTitle: msg.jobTitle, applicationId: msg.applicationId, at: Date.now() } });
      if (!msg.applicationId) {
        // Find (or create) the tracked application for this page; never marks it applied.
        const ctx = await call<PageContext>('/autofill/page', { body: { url: msg.url, title: msg.jobTitle, company: msg.company } }).catch(() => null);
        let applicationId = ctx?.application?.id ?? null;
        if (!applicationId) {
          const up = await call<{ application: { id: string } }>('/applications/upsert', { body: { jobUrl: msg.url, company: msg.company, jobTitle: msg.jobTitle, jobId: ctx?.job?.id ?? null, event: 'opened' } }).catch(() => null);
          applicationId = up?.application.id ?? null;
        }
        const cur = (await chrome.storage.session.get(key))[key];
        if (cur) await chrome.storage.session.set({ [key]: { ...cur, applicationId } });
      }
      return { ok: true };
    }
    case 'application/checkPending': {
      const tabId = sender.tab?.id;
      if (!tabId) return null;
      const key = `pending:${tabId}`;
      const p = (await chrome.storage.session.get(key))[key] as { at: number; url: string } | undefined;
      if (!p || Date.now() - p.at > 30 * 60_000) return null;
      if (msg.url && p.url === msg.url) return null; // still on (or reloaded) the form itself
      return p;
    }
    case 'application/dismissPending': {
      if (sender.tab?.id) await chrome.storage.session.remove(`pending:${sender.tab.id}`);
      return { ok: true };
    }
    case 'application/markApplied': {
      const r = await call(`/applications/${encodeURIComponent(msg.applicationId)}`, { method: 'PATCH', body: { status: 'applied', confirmedSubmission: true } });
      if (sender.tab?.id) await chrome.storage.session.remove(`pending:${sender.tab.id}`);
      return r;
    }
    case 'resume/file': {
      const path = msg.versionId ? `/versions/${encodeURIComponent(msg.versionId)}/export?format=pdf&force=1` : msg.resumeId ? `/resumes/${encodeURIComponent(msg.resumeId)}/export?format=pdf` : null;
      if (!path) throw new ApiFailure('No resume selected.', 'validation_error', 400);
      const res = await call<Response>(path, { raw: true });
      const name = (res.headers.get('content-disposition') ?? '').match(/filename="([^"]+)"/)?.[1] ?? 'resume.pdf';
      return { base64: b64(await res.arrayBuffer()), name, mime: 'application/pdf' };
    }
    case 'job/createAndOptimize': {
      const r = await call<{ job: { id: string } }>('/jobs', { body: { text: msg.description, url: msg.url, title: msg.title, company: msg.company, source: 'extension' } });
      const a = await getAuth();
      await chrome.tabs.create({ url: `${await dashboardBase(a.apiUrl)}/optimize?jobId=${r.job.id}${msg.resumeId ? `&resumeId=${msg.resumeId}` : ''}` });
      return r;
    }
    case 'open/dashboard': {
      const a = await getAuth();
      await chrome.tabs.create({ url: `${await dashboardBase(a.apiUrl)}${msg.path.startsWith('/') ? msg.path : `/${msg.path}`}` });
      return { ok: true };
    }
    case 'open/options':
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    case 'tab/scan': {
      // Uses the activeTab grant from the user's click on the toolbar button.
      await chrome.scripting.executeScript({ target: { tabId: msg.tabId, allFrames: true }, files: PAGE_READY_FILES, world: 'MAIN' });
      await chrome.scripting.executeScript({ target: { tabId: msg.tabId, allFrames: true }, files: CONTENT_FILES });
      return { ok: true };
    }
    case 'content/register': {
      if (!sender.tab?.id || sender.frameId === undefined) throw new ApiFailure('Invalid sender', 'forbidden', 403);
      const ch = await channels();
      ch[msg.nonce] = { tabId: sender.tab.id, frameId: sender.frameId, url: sender.url ?? '' };
      // keep the registry small
      const entries = Object.entries(ch).slice(-50);
      await chrome.storage.session.set({ channels: Object.fromEntries(entries) });
      return { ok: true };
    }
    case 'frame/host': {
      // A subframe's form (e.g. iCIMS' content iframe) asks the top frame to show its launcher/panel:
      // iframes sized to their content would otherwise put a fixed launcher far below the viewport.
      const ch = (await channels())[msg.nonce];
      if (!sender.tab?.id || !ch || ch.tabId !== sender.tab.id || ch.frameId !== sender.frameId || sender.frameId === 0) throw new ApiFailure('Invalid sender', 'forbidden', 403);
      return chrome.tabs.sendMessage(sender.tab.id, { type: 'content/host', nonce: msg.nonce, action: msg.action, count: msg.count } satisfies ContentRequest, { frameId: 0 });
    }
    case 'panel/hello': {
      const ch = (await channels())[msg.nonce];
      // The panel must be an extension frame hosted in the same tab as the registering content script.
      if (!ch || sender.tab?.id !== ch.tabId || !sender.url?.startsWith(chrome.runtime.getURL(''))) throw new ApiFailure('Unknown panel channel', 'forbidden', 403);
      return ch;
    }
    case 'relay': {
      const ch = (await channels())[msg.nonce];
      if (!ch) throw new ApiFailure('This page needs to be reloaded.', 'not_found', 404);
      const fromExtensionPage = !!sender.url?.startsWith(chrome.runtime.getURL(''));
      if (!fromExtensionPage) throw new ApiFailure('Relay only allowed from extension pages', 'forbidden', 403);
      if (sender.tab && sender.tab.id !== ch.tabId) throw new ApiFailure('Tab mismatch', 'forbidden', 403);
      return chrome.tabs.sendMessage(ch.tabId, msg.msg as ContentRequest, { frameId: ch.frameId });
    }
    case 'permissions/enableAllSites': {
      // Called after the options page obtained the optional permission from the user.
      const granted = await chrome.permissions.contains({ origins: ['https://*/*'] });
      if (!granted) throw new ApiFailure('Permission was not granted.', 'forbidden', 403);
      const existing = await chrome.scripting.getRegisteredContentScripts({ ids: ['px-all-sites'] });
      if (!existing.length) {
        await chrome.scripting.registerContentScripts([
          { id: 'px-all-sites', matches: ['https://*/*'], js: CONTENT_FILES, runAt: 'document_idle', allFrames: true, persistAcrossSessions: true },
          { id: 'px-all-sites-ready', matches: ['https://*/*'], js: PAGE_READY_FILES, runAt: 'document_end', allFrames: true, persistAcrossSessions: true, world: 'MAIN' },
        ]);
      }
      return { ok: true };
    }
  }
}

/** The dashboard URL comes from the server (/api/health), e.g. Vite in development. */
async function dashboardBase(apiUrl: string): Promise<string> {
  try {
    const r = await fetch(`${apiUrl}/api/health`, { credentials: 'omit' });
    const body = (await r.json()) as { webUrl?: string };
    return (body.webUrl || apiUrl).replace(/\/+$/, '');
  } catch {
    return apiUrl;
  }
}

chrome.runtime.onMessage.addListener((msg: BgRequest, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg !== 'object' || typeof msg.type !== 'string') return false;
  handle(msg, sender)
    .then((data) => sendResponse({ ok: true, data } satisfies Res<unknown>))
    .catch((e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : 'Unexpected error', code: e instanceof ApiFailure ? e.code : undefined } satisfies Res<unknown>));
  return true; // async response
});

chrome.runtime.onInstalled.addListener(async (d) => {
  if (d.reason === 'update') {
    // Before the rename to PINGx969 the optional all-sites scripts were registered as "rp-…": move them to the new ids.
    const legacy = await chrome.scripting.getRegisteredContentScripts({ ids: ['rp-all-sites', 'rp-all-sites-ready'] }).catch(() => []);
    if (legacy.length) {
      await chrome.scripting.unregisterContentScripts({ ids: legacy.map((s) => s.id) }).catch(() => undefined);
      await chrome.scripting
        .registerContentScripts([
          { id: 'px-all-sites', matches: ['https://*/*'], js: CONTENT_FILES, runAt: 'document_idle', allFrames: true, persistAcrossSessions: true },
          { id: 'px-all-sites-ready', matches: ['https://*/*'], js: PAGE_READY_FILES, runAt: 'document_end', allFrames: true, persistAcrossSessions: true, world: 'MAIN' },
        ])
        .catch(() => undefined);
    }
  }
  // First-run onboarding only; never interrupt someone who is already signed in.
  if (d.reason !== 'install') return;
  const { token } = await chrome.storage.local.get('token');
  if (!token) void chrome.runtime.openOptionsPage();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(`pending:${tabId}`);
});
