import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PlanItem } from '@pingx969/field-detector';
import { bg, type Bootstrap, type ContentState, type FillResultDto, type PageContext } from './messages';
import { STATUS_ICON, bestResume, makePlan, summarizePlan } from './planner';

interface AuthStatus {
  signedIn: boolean;
  email?: string;
  apiUrl: string;
  expired?: boolean;
  offline?: boolean;
  error?: string;
}

async function activeTab() {
  const forced = Number(new URLSearchParams(location.search).get('tabId'));
  if (forced) return chrome.tabs.get(forced);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function tabState(tabId: number): Promise<ContentState | null> {
  try {
    const r = (await chrome.tabs.sendMessage(tabId, { type: 'content/state' }, { frameId: 0 })) as { ok: boolean; data: ContentState } | undefined;
    return r?.ok ? r.data : null;
  } catch {
    return null; // no content script in this tab
  }
}

function Popup() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);
  const [state, setState] = useState<ContentState | null | 'none'>(null);
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [ctx, setCtx] = useState<PageContext | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setError('');
    const a = await bg<AuthStatus>({ type: 'auth/status' }).catch((e: Error) => ({ signedIn: false, apiUrl: '', error: e.message }) as AuthStatus);
    setAuth(a);
    const tab = await activeTab();
    if (!tab?.id) return;
    setTabId(tab.id);
    const s = await tabState(tab.id);
    setState(s ?? 'none');
    if (s && a.signedIn) {
      try {
        const d = await bg<Bootstrap>({ type: 'data/bootstrap', force: true });
        setPlan(makePlan(s, d));
        setCtx(await bg<PageContext>({ type: 'page/context', url: s.url, title: s.job.title, company: s.job.company }).catch(() => null));
      } catch (e) {
        setError((e as Error).message);
      }
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const scan = async () => {
    if (!tabId) return;
    setBusy(true);
    try {
      await bg({ type: 'tab/scan', tabId });
      await new Promise((r) => setTimeout(r, 400));
      await refresh();
    } catch (e) {
      setError(`This page can't be scanned (${(e as Error).message}). Browser pages and the Chrome Web Store are off-limits to extensions.`);
    } finally {
      setBusy(false);
    }
  };

  const autofill = async () => {
    if (!tabId || !state || state === 'none') return;
    setBusy(true);
    setError('');
    try {
      const ready = plan.filter((p) => p.status === 'ready');
      const resume = bestResume(ctx);
      const resumeField = plan.find((p) => p.status === 'file' && p.fieldType === 'resume');
      let file = null;
      if (resumeField && (resume.versionId || resume.resumeId)) {
        const f = await bg<{ base64: string; name: string; mime: string }>({ type: 'resume/file', versionId: resume.versionId, resumeId: resume.resumeId });
        file = { ...f, fieldId: resumeField.fieldId };
      }
      const r = (await chrome.tabs.sendMessage(tabId, { type: 'content/fill', items: ready.map((p) => ({ fieldId: p.fieldId, value: p.value })), resume: file }, { frameId: 0 })) as { ok: boolean; data: FillResultDto[] };
      const ok = r.data.filter((x) => x.ok).length;
      await bg({ type: 'application/upsert', jobUrl: state.url, company: state.job.company || ctx?.job?.company || '', jobTitle: state.job.title || ctx?.job?.title || '', jobId: ctx?.job?.id ?? null, resumeVersionId: resume.versionId, matchScore: resume.match, fieldsFilled: ok, event: 'autofilled' }).catch(() => undefined);
      const attention = summarizePlan(plan).attention;
      setMsg(`Filled ${ok} field${ok === 1 ? '' : 's'}.${attention ? ` ${attention} need your attention — opening the review panel.` : ' Review the page, then submit it yourself.'}`);
      if (attention) await chrome.tabs.sendMessage(tabId, { type: 'content/openPanel' }, { frameId: 0 });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const review = async () => {
    if (!tabId) return;
    await chrome.tabs.sendMessage(tabId, { type: 'content/openPanel' }, { frameId: 0 }).catch(() => setError('Reload the page and try again.'));
    window.close();
  };
  const optimize = async () => {
    if (!state || state === 'none') return;
    if (ctx?.recommendedVersion) await bg({ type: 'open/dashboard', path: `/versions/${ctx.recommendedVersion.id}` });
    else if (state.job.description.length > 80) await bg({ type: 'job/createAndOptimize', url: state.url, title: state.job.title, company: state.job.company, description: state.job.description, resumeId: ctx?.defaultResume?.id ?? null }).catch((e: Error) => setError(e.message));
    else await bg({ type: 'open/dashboard', path: `/optimize?url=${encodeURIComponent(state.url)}` });
  };
  const markApplied = async () => {
    if (!ctx?.application) return;
    await bg({ type: 'application/markApplied', applicationId: ctx.application.id }).then(() => setMsg('Marked as applied.')).catch((e: Error) => setError(e.message));
    setCtx({ ...ctx, application: { ...ctx.application, status: 'applied' } });
  };

  if (!auth) return <div className="popup muted">Loading…</div>;
  if (!auth.signedIn) {
    return (
      <div className="popup">
        <h1>Job Application Assistant</h1>
        {auth.expired && <div className="alert warn">Your session expired.</div>}
        {auth.error && <div className="alert error">{auth.error}</div>}
        <p className="muted">Sign in to your PINGx969 account to autofill applications.</p>
        <button className="btn primary block" onClick={() => void bg({ type: 'open/options' })}>
          Sign in
        </button>
      </div>
    );
  }

  const sum = summarizePlan(plan);
  const resume = bestResume(ctx);
  const s = state && state !== 'none' ? state : null;
  return (
    <div className="popup">
      <h1>Job Application Assistant</h1>
      {auth.offline && <div className="alert warn">Server unreachable — {auth.error}</div>}
      {state === 'none' && (
        <>
          <p className="muted">PINGx969 isn’t running on this page.</p>
          <button className="btn primary block" disabled={busy} onClick={() => void scan()}>
            Scan this page
          </button>
        </>
      )}
      {s && (
        <>
          <div className="muted small">{[s.job.title, s.job.company].filter(Boolean).join(' · ') || s.host}</div>
          <ul className="stats" aria-live="polite">
            <li>✓ {sum.detected} fields detected</li>
            <li>✓ {sum.fillable} fields can be filled</li>
            <li className={sum.attention ? 'warn' : ''}>
              {sum.attention ? '⚠' : '✓'} {sum.attention} fields need attention
            </li>
          </ul>
          {resume.match != null && <div className="match">Match: {resume.match}%</div>}
          {!s.isApplication && sum.detected === 0 && <p className="muted small">No application form detected here.</p>}
          <div className="actions">
            <button className="btn primary block" disabled={busy || sum.fillable === 0} onClick={() => void autofill()}>
              {busy ? 'Working…' : 'Autofill Application'}
            </button>
            <button className="btn block" disabled={sum.detected === 0} onClick={() => void review()}>
              Review Answers
            </button>
            <button className="btn block" onClick={() => void optimize()}>
              Optimize Resume
            </button>
            {ctx?.application && ctx.application.status !== 'applied' && (
              <button className="btn block" onClick={() => void markApplied()}>
                I submitted this application
              </button>
            )}
          </div>
          <ul className="field-list">
            {plan
              .filter((p) => p.status !== 'skipped')
              .slice(0, 14)
              .map((p) => (
                <li key={p.fieldId} className={`s-${p.status}`}>
                  <span aria-hidden="true">{STATUS_ICON[p.status]}</span> {p.label}
                </li>
              ))}
          </ul>
        </>
      )}
      {msg && <div className="alert good">{msg}</div>}
      {error && <div className="alert error">{error}</div>}
      <div className="foot">
        <span className="muted small">{auth.email}</span>
        <button className="link" onClick={() => void bg({ type: 'open/dashboard', path: '/' })}>
          Dashboard
        </button>
        <button className="link" onClick={() => void bg({ type: 'open/options' })}>
          Settings
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
