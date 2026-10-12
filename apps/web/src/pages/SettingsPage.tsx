import { useState } from 'react';
import type { ScoringWeights } from '@pingx969/shared';
import { api, download, fmtDate } from '../api';
import { useAuth } from '../auth';
import { ErrorBox, Loading, useLoad, useToast, errMsg } from '../ui';
import type { SettingsResponse } from '../types';

interface SessionInfo {
  id: string;
  kind: 'web' | 'extension';
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  userAgent: string;
  current: boolean;
}

export function SettingsPage() {
  const toast = useToast();
  const { logout } = useAuth();
  const { data, setData, error, loading, reload } = useLoad(async () => {
    const [s, ss] = await Promise.all([api<SettingsResponse>('/settings'), api<{ sessions: SessionInfo[] }>('/auth/sessions')]);
    return { ...s, sessions: ss.sessions };
  });
  const [weights, setWeights] = useState<ScoringWeights | null>(null);
  const [password, setPassword] = useState('');

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const d = data!;
  const w = weights ?? d.settings.scoringWeights;
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;

  const put = async (patch: Partial<SettingsResponse['settings']>) => {
    try {
      const r = await api<{ settings: SettingsResponse['settings'] }>('/settings', { method: 'PUT', body: patch });
      setData((x) => (x ? { ...x, settings: r.settings } : x));
      toast('Settings saved.');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  const revoke = async (id: string) => {
    try {
      await api(`/auth/sessions/${id}`, { method: 'DELETE' });
      setData((x) => (x ? { ...x, sessions: x.sessions.filter((s) => s.id !== id) } : x));
      toast('Session signed out.');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  const deleteAccount = async () => {
    if (!window.confirm('Permanently delete your account, resumes, versions, applications and saved answers? This cannot be undone.')) return;
    try {
      await api('/account', { method: 'DELETE', body: { password } });
      await logout();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Scoring, AI, autofill behavior and your data.</p>
        </div>
      </div>

      <div className="card stack">
        <div className="spread">
          <h2>Match scoring weights</h2>
          <div className="row">
            <button className="btn btn-sm" onClick={() => setWeights(Object.fromEntries(d.dimensions.map((x) => [x.key, x.defaultWeight])) as ScoringWeights)}>
              Reset to defaults
            </button>
            <button className="btn btn-sm btn-primary" disabled={!weights} onClick={() => weights && void put({ scoringWeights: weights }).then(() => setWeights(null))}>
              Save weights
            </button>
          </div>
        </div>
        <p className="muted small">The overall match is the weighted average of the dimensions that apply to a job. Weights are relative; set one to 0 to ignore it.</p>
        <div className="stack" style={{ gap: 14 }}>
          {d.dimensions.map((dim) => (
            <div key={dim.key} className="grid" style={{ gridTemplateColumns: 'minmax(140px, 200px) 1fr 70px', alignItems: 'center', gap: 12 }}>
              <label htmlFor={`w-${dim.key}`} title={dim.description}>
                <strong>{dim.label}</strong>
                <div className="help">{dim.description.slice(0, 90)}…</div>
              </label>
              <input id={`w-${dim.key}`} type="range" min={0} max={50} value={w[dim.key]} onChange={(e) => setWeights({ ...w, [dim.key]: Number(e.target.value) })} />
              <span className="num small">
                {w[dim.key]} <span className="muted">({Math.round((w[dim.key] / total) * 100)}%)</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="card stack">
        <h2>AI provider</h2>
        <p className="muted small">The built-in optimizer runs entirely on your server. External AI providers receive your resume text with contact details removed, and you’re asked to confirm each time. All AI output is validated against your resume before it can be applied.</p>
        <div className="field" style={{ maxWidth: 420 }}>
          <label htmlFor="ai">Default engine</label>
          <select id="ai" className="input" value={d.settings.aiProvider} onChange={(e) => void put({ aiProvider: e.target.value })}>
            {d.providers.map((p) => (
              <option key={p.name} value={p.name} disabled={!p.available}>
                {p.name === 'heuristic' ? 'Built-in (private)' : `Claude — ${p.model}${p.available ? '' : ' (not configured)'}`}
              </option>
            ))}
          </select>
          {d.providers.filter((p) => !p.available && p.reason).map((p) => (
            <span key={p.name} className="help">
              {p.reason}
            </span>
          ))}
        </div>
      </div>

      <div className="card stack">
        <h2>Autofill</h2>
        <label className="checkbox">
          <input type="checkbox" checked={d.settings.autoLearn} onChange={(e) => void put({ autoLearn: e.target.checked })} />
          <span>
            <strong>Learn answers as I apply</strong>
            <div className="help">When you type an answer to a question the extension didn’t know, save it for next time (stored encrypted; editable on the Saved answers page).</div>
          </span>
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={d.settings.showLauncher} onChange={(e) => void put({ showLauncher: e.target.checked })} />
          <span>
            <strong>Show the autofill button on application pages</strong>
            <div className="help">You can always use the toolbar popup instead.</div>
          </span>
        </label>
      </div>

      <div className="card stack">
        <h2>Signed-in devices</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Last used</th>
                <th>Expires</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {d.sessions.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.kind === 'extension' ? 'Browser extension' : 'Web dashboard'} {s.current && <span className="badge badge-brand">This session</span>}
                    <div className="small muted">{s.userAgent.slice(0, 70)}</div>
                  </td>
                  <td className="small">{fmtDate(s.lastUsedAt)}</td>
                  <td className="small">{fmtDate(s.expiresAt)}</td>
                  <td>{!s.current && <button className="btn btn-sm" onClick={() => void revoke(s.id)}>Sign out</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card stack">
        <h2>Your data</h2>
        <p className="muted small">Personal data (profile, resumes, versions, answers, uploaded files) is encrypted at rest. Passwords for job websites are never stored.</p>
        <div>
          <button className="btn" onClick={() => void download('/account/export', 'pingx969-export.json').catch((e) => toast(errMsg(e), 'error'))}>
            Export all my data (JSON)
          </button>
        </div>
        <div className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <strong style={{ color: 'var(--bad)' }}>Delete account</strong>
          <div className="row">
            <input className="input" style={{ maxWidth: 260 }} type="password" placeholder="Confirm your password" aria-label="Confirm password to delete account" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button className="btn btn-danger" disabled={!password} onClick={() => void deleteAccount()}>
              Delete everything
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
