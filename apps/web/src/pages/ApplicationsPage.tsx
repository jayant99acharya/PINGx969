import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApplicationStatusLabels, ApplicationStatuses, type ApplicationStatus } from '@pingx969/shared';
import { api, fmtDate } from '../api';
import { Empty, ErrorBox, Icon, Loading, ScorePill, useLoad, useToast, errMsg } from '../ui';
import type { ApplicationRow, VersionRow } from '../types';

export function ApplicationsPage() {
  const toast = useToast();
  const [status, setStatus] = useState<string>('');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const { data, setData, error, loading, reload } = useLoad(async () => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (q.trim()) qs.set('q', q.trim());
    const [a, v] = await Promise.all([api<{ applications: ApplicationRow[] }>(`/applications?${qs}`), api<{ versions: VersionRow[] }>('/versions')]);
    return { apps: a.applications, versions: v.versions };
  }, [status, q]);

  const update = async (id: string, patch: Partial<ApplicationRow> & { confirmedSubmission?: boolean }) => {
    try {
      const r = await api<{ application: ApplicationRow }>(`/applications/${id}`, { method: 'PATCH', body: patch });
      setData((d) => (d ? { ...d, apps: d.apps.map((a) => (a.id === id ? r.application : a)) } : d));
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  const remove = async (id: string) => {
    if (!window.confirm('Delete this application record?')) return;
    try {
      await api(`/applications/${id}`, { method: 'DELETE' });
      setData((d) => (d ? { ...d, apps: d.apps.filter((a) => a.id !== id) } : d));
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head">
        <div>
          <h1>Applications</h1>
          <p>Created automatically when you autofill with the extension, or add them yourself.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding((x) => !x)}>
          <Icon name="plus" /> Add application
        </button>
      </div>
      {adding && data && (
        <NewApplication
          versions={data.versions}
          onCreated={(a) => {
            setAdding(false);
            setData((d) => (d ? { ...d, apps: [a, ...d.apps] } : d));
            toast('Application added.');
          }}
        />
      )}
      <div className="row">
        <div className="field" style={{ flex: '1 1 240px' }}>
          <label htmlFor="app-search" className="sr-only">
            Search applications
          </label>
          <input id="app-search" className="input" placeholder="Search company or role…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input" style={{ width: 180 }} aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {ApplicationStatuses.map((s) => (
            <option key={s} value={s}>
              {ApplicationStatusLabels[s]}
            </option>
          ))}
        </select>
      </div>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data!.apps.length ? (
        <div className="card">
          <Empty title={q || status ? 'No matching applications' : 'No applications yet'}>
            Open a job application with the PINGx969 extension and click Autofill — the application is tracked here automatically. It’s only marked “Applied” after you confirm you submitted it.
          </Empty>
        </div>
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Role</th>
                <th className="num">Match</th>
                <th>Status</th>
                <th>Resume version</th>
                <th>Date</th>
                <th>Notes</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data!.apps.map((a) => {
                const version = data!.versions.find((v) => v.id === a.resumeVersionId);
                return (
                  <tr key={a.id} data-application-id={a.id}>
                    <td>
                      <strong>{a.company || '—'}</strong>
                      {a.jobUrl && (
                        <div className="small">
                          <a href={a.jobUrl} target="_blank" rel="noreferrer noopener">
                            Job link
                          </a>
                        </div>
                      )}
                    </td>
                    <td>{a.jobTitle || '—'}</td>
                    <td className="num">
                      <ScorePill value={a.matchScore} />
                    </td>
                    <td>
                      <select
                        className="input"
                        style={{ height: 30, width: 130 }}
                        aria-label={`Status for ${a.company}`}
                        value={a.status}
                        onChange={(e) => void update(a.id, { status: e.target.value as ApplicationStatus, confirmedSubmission: e.target.value === 'applied' })}
                      >
                        {ApplicationStatuses.map((s) => (
                          <option key={s} value={s}>
                            {ApplicationStatusLabels[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="small">{version ? <Link to={`/versions/${version.id}`}>{version.label}</Link> : <span className="muted">—</span>}</td>
                    <td className="small muted">{a.appliedAt ? `Applied ${fmtDate(a.appliedAt)}` : `Added ${fmtDate(a.createdAt)}`}</td>
                    <td style={{ minWidth: 180 }}>
                      <input className="input" style={{ height: 30 }} aria-label={`Notes for ${a.company}`} defaultValue={a.notes} onBlur={(e) => e.target.value !== a.notes && void update(a.id, { notes: e.target.value })} placeholder="Add a note" />
                    </td>
                    <td>
                      <button className="btn btn-sm btn-ghost btn-danger" onClick={() => void remove(a.id)} aria-label={`Delete application for ${a.company}`}>
                        <Icon name="trash" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NewApplication({ versions, onCreated }: { versions: VersionRow[]; onCreated: (a: ApplicationRow) => void }) {
  const [form, setForm] = useState({ company: '', jobTitle: '', jobUrl: '', status: 'saved' as ApplicationStatus, resumeVersionId: '', notes: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const v = versions.find((x) => x.id === form.resumeVersionId);
      const r = await api<{ application: ApplicationRow }>('/applications', { body: { ...form, resumeVersionId: form.resumeVersionId || null, matchScore: v?.matchAfter ?? null } });
      onCreated(r.application);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <form className="card stack" onSubmit={submit}>
      <h2>New application</h2>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="na-company">Company</label>
          <input id="na-company" className="input" value={form.company} onChange={set('company')} />
        </div>
        <div className="field">
          <label htmlFor="na-title">Role</label>
          <input id="na-title" className="input" value={form.jobTitle} onChange={set('jobTitle')} />
        </div>
        <div className="field">
          <label htmlFor="na-url">Job URL</label>
          <input id="na-url" className="input" type="url" value={form.jobUrl} onChange={set('jobUrl')} />
        </div>
        <div className="field">
          <label htmlFor="na-status">Status</label>
          <select id="na-status" className="input" value={form.status} onChange={set('status')}>
            {ApplicationStatuses.map((s) => (
              <option key={s} value={s}>
                {ApplicationStatusLabels[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="na-version">Resume version</label>
          <select id="na-version" className="input" value={form.resumeVersionId} onChange={set('resumeVersionId')}>
            <option value="">None</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ErrorBox error={error} />
      <div>
        <button className="btn btn-primary" disabled={busy}>
          Save application
        </button>
      </div>
    </form>
  );
}
