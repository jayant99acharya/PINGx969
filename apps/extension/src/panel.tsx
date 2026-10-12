import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FieldTypeLabels, FieldTypes, type FieldType } from '@pingx969/shared';
import type { PlanItem } from '@pingx969/field-detector';
import { bg, type Bootstrap, type ContentRequest, type ContentState, type FillResultDto, type PageContext, type PanelEvent } from './messages';
import { STATUS_ICON, bestResume, makePlan, summarizePlan } from './planner';

const nonce = location.hash.slice(1);
const relay = <T,>(msg: ContentRequest) =>
  bg<{ ok: boolean; data: T; error?: string }>({ type: 'relay', nonce, msg }).then((r) => {
    if (!r?.ok) throw new Error(r?.error ?? 'The page did not respond. Reload it and try again.');
    return r.data;
  });

interface RowState {
  value: string;
  include: boolean;
  remember: boolean;
  overwrite: boolean;
  touched: boolean;
}

function initialRow(p: PlanItem): RowState {
  return {
    value: p.value,
    include: p.status === 'ready' || (p.status === 'review' && !!p.value),
    remember: false,
    overwrite: false,
    touched: false,
  };
}

function Panel() {
  const [state, setState] = useState<ContentState | null>(null);
  const [data, setData] = useState<Bootstrap | null>(null);
  const [ctx, setCtx] = useState<PageContext | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<FillResultDto[] | null>(null);
  const [attach, setAttach] = useState(true);
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState<'all' | 'attention'>('all');

  const load = useCallback(async (fresh = true) => {
    setError('');
    try {
      await bg({ type: 'panel/hello', nonce });
      const [s, d] = await Promise.all([relay<ContentState>({ type: 'content/state' }), bg<Bootstrap>({ type: 'data/bootstrap', force: fresh })]);
      setState(s);
      setData(d);
      bg<PageContext>({ type: 'page/context', url: s.url, title: s.job.title, company: s.job.company })
        .then(setCtx)
        .catch(() => setCtx(null));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const onMsg = (m: PanelEvent) => {
      if (m?.nonce !== nonce) return;
      if (m.type === 'panel/fieldsChanged') void load(false);
      if (m.type === 'panel/learned') {
        const d = m.data as { label: string; queued?: boolean; profile?: boolean };
        setNotice(d.profile ? `Saved “${d.label}” to your profile.` : `Remembered your answer to “${d.label}”${d.queued ? ' (will sync when online)' : ''}.`);
        void load(false);
      }
    };
    chrome.runtime.onMessage.addListener(onMsg);
    return () => chrome.runtime.onMessage.removeListener(onMsg);
  }, [load]);

  const plan = useMemo(() => (state && data ? makePlan(state, data) : []), [state, data]);
  useEffect(() => {
    setRows((prev) => {
      const next: Record<string, RowState> = {};
      for (const p of plan) next[p.fieldId] = prev[p.fieldId]?.touched ? prev[p.fieldId] : initialRow(p);
      return next;
    });
  }, [plan]);

  const visible = plan.filter((p) => p.status !== 'skipped' && (filter === 'all' || ['review', 'unknown', 'manual'].includes(p.status)));
  const sum = summarizePlan(plan);
  const resume = bestResume(ctx);
  const resumeField = plan.find((p) => p.status === 'file' && p.fieldType === 'resume');

  const setRow = (id: string, patch: Partial<RowState>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch, touched: true } }));

  const fill = async () => {
    if (!state) return;
    setBusy(true);
    setError('');
    setResults(null);
    try {
      const items = plan
        .filter((p) => rows[p.fieldId]?.include && rows[p.fieldId].value.trim() && p.status !== 'file' && p.status !== 'manual')
        .map((p) => ({ fieldId: p.fieldId, value: rows[p.fieldId].value, overwrite: p.status === 'prefilled' ? rows[p.fieldId].overwrite : false }));
      let resumeFile: { base64: string; name: string; mime: string; fieldId: string } | null = null;
      if (attach && resumeField && (resume.versionId || resume.resumeId)) {
        const f = await bg<{ base64: string; name: string; mime: string }>({ type: 'resume/file', versionId: resume.versionId, resumeId: resume.resumeId });
        resumeFile = { ...f, fieldId: resumeField.fieldId };
      }
      const res = await relay<FillResultDto[]>({ type: 'content/fill', items, resume: resumeFile });
      setResults(res);
      // Remember answers the user explicitly asked to keep
      const remembered = plan.filter((p) => rows[p.fieldId]?.remember && rows[p.fieldId].value.trim() && p.questionKey);
      for (const p of remembered) {
        await bg({ type: 'answers/save', question: p.question || p.label, answer: rows[p.fieldId].value.trim(), source: 'user', questionKey: p.questionKey });
      }
      const usedKeys = plan.filter((p) => p.source === 'saved' && rows[p.fieldId]?.include).map((p) => p.questionKey!).filter(Boolean);
      if (usedKeys.length) void bg({ type: 'answers/used', keys: usedKeys });
      const okCount = res.filter((r) => r.ok).length;
      await bg({
        type: 'application/upsert',
        jobUrl: state.url,
        company: state.job.company || ctx?.job?.company || '',
        jobTitle: state.job.title || ctx?.job?.title || '',
        jobId: ctx?.job?.id ?? null,
        resumeVersionId: resume.versionId,
        matchScore: resume.match,
        fieldsFilled: okCount,
        event: 'autofilled',
      }).catch(() => undefined);
      setNotice(`Filled ${okCount} field${okCount === 1 ? '' : 's'}${remembered.length ? ` and remembered ${remembered.length} answer${remembered.length === 1 ? '' : 's'}` : ''}. Review the page, then submit it yourself.`);
      await load(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveMapping = async (p: PlanItem, fieldType: FieldType) => {
    if (!state) return;
    try {
      await bg({ type: 'mappings/save', host: state.host, signature: p.signature, label: p.label, fieldType, questionKey: fieldType === 'question' ? p.questionKey : null });
      setNotice(`Got it — “${p.label}” will be treated as ${FieldTypeLabels[fieldType] ?? fieldType} on this site.`);
      await load(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const optimize = async () => {
    if (!state) return;
    try {
      if (ctx?.recommendedVersion) await bg({ type: 'open/dashboard', path: `/versions/${ctx.recommendedVersion.id}` });
      else {
        if (!state.job.description || state.job.description.length < 80) {
          await bg({ type: 'open/dashboard', path: `/optimize?url=${encodeURIComponent(state.url)}&title=${encodeURIComponent(state.job.title)}&company=${encodeURIComponent(state.job.company)}` });
        } else await bg({ type: 'job/createAndOptimize', url: state.url, title: state.job.title, company: state.job.company, description: state.job.description, resumeId: ctx?.defaultResume?.id ?? null });
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const close = () => void relay({ type: 'content/closePanel' });

  if (error && !state) {
    const needsLogin = /sign in|session/i.test(error);
    const serverDown = /reach the PINGx969 server/i.test(error);
    return (
      <div className="panel">
        <Header onClose={close} />
        <div className="alert error">{error}</div>
        {(needsLogin || serverDown) && (
          <button className="btn primary" onClick={() => void bg({ type: 'open/options' })}>
            {needsLogin ? 'Open sign-in' : 'Open settings (server URL)'}
          </button>
        )}
        <button className="btn" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }
  if (!state || !data) {
    return (
      <div className="panel">
        <Header onClose={close} />
        <p className="muted">Reading the application form…</p>
      </div>
    );
  }

  const fillable = plan.filter((p) => rows[p.fieldId]?.include && rows[p.fieldId].value.trim() && p.status !== 'file' && p.status !== 'manual').length;

  return (
    <div className="panel">
      <Header onClose={close} />
      <section className="job">
        <div className="title">{state.job.title || 'Job application'}</div>
        <div className="muted">{state.job.company || state.host}</div>
        {ctx?.job ? (
          <div className="row">
            {resume.match != null && <span className={`pill ${resume.match >= 75 ? 'good' : resume.match >= 55 ? 'warn' : 'bad'}`}>Match {resume.match}%</span>}
            <button className="link" onClick={() => void optimize()}>
              {ctx.recommendedVersion ? 'View tailored resume' : 'Optimize resume'}
            </button>
          </div>
        ) : (
          <button className="btn small" onClick={() => void optimize()}>
            Optimize resume for this job
          </button>
        )}
      </section>

      <section className="summary" aria-live="polite">
        <div>✓ {sum.detected} fields detected</div>
        <div>✓ {sum.fillable} can be filled</div>
        <div className={sum.attention ? 'warn' : ''}>
          {sum.attention ? '⚠' : '✓'} {sum.attention} need{sum.attention === 1 ? 's' : ''} attention
        </div>
      </section>

      {resumeField && (
        <label className="check resume">
          <input type="checkbox" checked={attach} disabled={!resume.label} onChange={(e) => setAttach(e.target.checked)} />
          <span>
            Attach resume: <strong>{resume.label || 'no resume uploaded yet'}</strong>
          </span>
        </label>
      )}

      {notice && <div className="alert good">{notice}</div>}
      {error && <div className="alert error">{error}</div>}

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={filter === 'all'} onClick={() => setFilter('all')}>
          All fields
        </button>
        <button role="tab" aria-selected={filter === 'attention'} onClick={() => setFilter('attention')}>
          Needs attention ({sum.attention})
        </button>
      </div>

      <ul className="fields">
        {visible.map((p) => {
          const r = rows[p.fieldId] ?? initialRow(p);
          const res = results?.find((x) => x.fieldId === p.fieldId);
          return (
            <li key={p.fieldId} className={`field s-${p.status}`} data-field-id={p.fieldId} data-status={p.status}>
              <div className="head">
                <span className="icon" aria-label={p.status}>
                  {STATUS_ICON[p.status]}
                </span>
                <span className="label" title={p.question ?? p.label}>
                  {p.label}
                </span>
                {p.sensitive && <span className="tag">sensitive</span>}
                <FieldTypeMenu current={p.fieldType} onPick={(t) => void saveMapping(p, t)} />
              </div>
              {p.status === 'file' ? (
                <div className="muted small">{p.fieldType === 'resume' ? (attach && resume.label ? `Will attach: ${resume.label}` : 'Attach your resume manually.') : p.note}</div>
              ) : p.status === 'manual' ? (
                <div className="muted small">{p.note}</div>
              ) : (
                <>
                  {p.kind === 'checkbox-group' ? (
                    <div className="answer multi" role="group" aria-label={p.label}>
                      {p.options.map((o) => {
                        const selected = r.value.split(/\s*,\s*/).filter(Boolean);
                        const on = selected.includes(o.label);
                        return (
                          <label key={`${o.value}|${o.label}`} className="check">
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={(e) => {
                                const next = e.target.checked ? [...selected, o.label] : selected.filter((x) => x !== o.label);
                                setRow(p.fieldId, { value: next.join(', '), include: next.length > 0 });
                              }}
                            />{' '}
                            {o.label}
                          </label>
                        );
                      })}
                    </div>
                  ) : p.options.length > 0 && p.kind !== 'checkbox' ? (
                    <select
                      className="answer"
                      aria-label={p.label}
                      value={r.value}
                      onChange={(e) => setRow(p.fieldId, { value: e.target.value, include: !!e.target.value })}
                    >
                      <option value="">{p.status === 'unknown' ? 'Choose an answer…' : '—'}</option>
                      {p.options
                        .filter((o) => o.label && !/^(select|choose|please select|--)/i.test(o.label))
                        .map((o) => (
                          <option key={`${o.value}|${o.label}`} value={o.label}>
                            {o.label}
                          </option>
                        ))}
                      {r.value && !p.options.some((o) => o.label === r.value) && <option value={r.value}>{r.value}</option>}
                    </select>
                  ) : p.kind === 'textarea' || (p.question && p.question.length > 60) ? (
                    <textarea className="answer" aria-label={p.label} rows={2} value={r.value} placeholder={p.status === 'unknown' ? 'Enter answer' : ''} onChange={(e) => setRow(p.fieldId, { value: e.target.value, include: !!e.target.value.trim() })} />
                  ) : (
                    <input className="answer" aria-label={p.label} value={r.value} placeholder={p.status === 'unknown' ? 'Enter answer' : ''} onChange={(e) => setRow(p.fieldId, { value: e.target.value, include: !!e.target.value.trim() })} />
                  )}
                  {p.note && <div className={`note ${p.status}`}>{p.note}</div>}
                  <div className="row small">
                    {p.status === 'prefilled' ? (
                      <label className="check">
                        <input type="checkbox" checked={r.overwrite && r.include} onChange={(e) => setRow(p.fieldId, { overwrite: e.target.checked, include: e.target.checked })} /> Replace “{p.currentValue}”
                      </label>
                    ) : (
                      <label className="check">
                        <input type="checkbox" checked={r.include} onChange={(e) => setRow(p.fieldId, { include: e.target.checked })} /> Fill
                      </label>
                    )}
                    {p.questionKey && (p.status === 'unknown' || p.status === 'review' || r.touched) && (
                      <label className="check">
                        <input type="checkbox" checked={r.remember} onChange={(e) => setRow(p.fieldId, { remember: e.target.checked })} /> Remember this answer
                      </label>
                    )}
                  </div>
                </>
              )}
              {res && <div className={`note ${res.ok ? 'ok' : 'review'}`}>{res.ok ? 'Filled ✓' : res.reason}</div>}
            </li>
          );
        })}
      </ul>

      <footer>
        <button className="btn primary" disabled={busy || (fillable === 0 && !(attach && resumeField && resume.label))} onClick={() => void fill()}>
          {busy ? 'Filling…' : `Fill ${fillable} field${fillable === 1 ? '' : 's'}`}
        </button>
        <button className="btn" onClick={close}>
          Close
        </button>
        <p className="muted small">Nothing is submitted for you. Review the form, then submit it yourself.</p>
      </footer>
    </div>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  return (
    <header className="top">
      <strong>⚡ PINGx969</strong>
      <button className="icon-btn" aria-label="Close panel" onClick={onClose}>
        ×
      </button>
    </header>
  );
}

const PICKABLE = FieldTypes.filter((t) => !['unknown', 'resume', 'coverLetter'].includes(t));

function FieldTypeMenu({ current, onPick }: { current: FieldType; onPick: (t: FieldType) => void }) {
  return (
    <select className="type-menu" aria-label="Correct the field type" title="Wrong field? Tell us what it is" value="" onChange={(e) => e.target.value && onPick(e.target.value as FieldType)}>
      <option value="">{FieldTypeLabels[current] ?? (current === 'question' ? 'Question' : current)} ▾</option>
      {PICKABLE.map((t) => (
        <option key={t} value={t}>
          {FieldTypeLabels[t] ?? t}
        </option>
      ))}
    </select>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Panel />
  </StrictMode>,
);
