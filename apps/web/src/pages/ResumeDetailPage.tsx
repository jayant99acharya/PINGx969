import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatDateForDisplay } from '@pingx969/shared';
import { api, download } from '../api';
import { ErrorBox, Icon, Loading, useLoad, useToast, errMsg } from '../ui';
import type { ResumeDetail } from '../types';
import { DocPreview } from './Preview';

export function ResumeDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState<'parsed' | 'preview'>('parsed');
  const { data, error, loading, reload } = useLoad(() => api<ResumeDetail>(`/resumes/${id}`), [id]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const r = data!;
  const d = r.data;
  const fmt = r.resume.sourceFormat;

  const importProfile = async () => {
    try {
      await api(`/resumes/${id}/import-to-profile`, { method: 'POST' });
      toast('Profile updated with any missing details from this resume.');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  const dl = (format: string) => download(`/resumes/${id}/export?format=${format}`, `${r.resume.name}.${format}`).catch((e) => toast(errMsg(e), 'error'));

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head">
        <div>
          <div className="row">
            <h1>{r.resume.name}</h1>
            <span className="badge">{fmt.toUpperCase()}</span>
            <span className="badge badge-good">Original</span>
          </div>
          <p>
            {r.facts.years} years of experience · {r.facts.skills.length} skills detected · highest degree: {r.facts.highestDegree}
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => void importProfile()}>
            Import into profile
          </button>
          <button className="btn" onClick={() => void download(`/resumes/${id}/original?download=1`, r.resume.name)}>
            <Icon name="download" /> Original file
          </button>
          <button className="btn btn-primary" onClick={() => nav(`/optimize?resumeId=${id}`)}>
            <Icon name="spark" /> Tailor to a job
          </button>
        </div>
      </div>
      {r.warnings.map((w) => (
        <div className="alert alert-warn" key={w}>
          {w}
        </div>
      ))}
      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={tab === 'parsed'} onClick={() => setTab('parsed')}>
          Parsed content
        </button>
        <button className="tab" role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')}>
          Original document
        </button>
      </div>
      {tab === 'preview' ? (
        <div className="card">
          <DocPreview path={`/resumes/${id}/original`} kind={fmt === 'pdf' ? 'pdf' : fmt === 'docx' ? 'docx' : 'text'} title="Original resume" />
          <div className="row" style={{ marginTop: 12 }}>
            <span className="muted small">Download as:</span>
            {r.capabilities.map((c) => (
              <button key={c.format} className="btn btn-sm" onClick={() => void dl(c.format)} title={c.note}>
                {c.format.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-2">
          <div className="card stack">
            <h2>Contact</h2>
            <dl className="small" style={{ margin: 0, display: 'grid', gridTemplateColumns: '110px 1fr', gap: '6px 12px' }}>
              <dt className="muted">Name</dt>
              <dd style={{ margin: 0 }}>{d.personal.name || '—'}</dd>
              <dt className="muted">Email</dt>
              <dd style={{ margin: 0 }}>{d.personal.email || '—'}</dd>
              <dt className="muted">Phone</dt>
              <dd style={{ margin: 0 }}>{d.personal.phone || '—'}</dd>
              <dt className="muted">Location</dt>
              <dd style={{ margin: 0 }}>{d.personal.location || '—'}</dd>
              <dt className="muted">Links</dt>
              <dd style={{ margin: 0 }}>{d.links.map((l) => l.url).join(', ') || '—'}</dd>
            </dl>
            {d.summary.text && (
              <>
                <h2>Summary</h2>
                <p>{d.summary.text}</p>
              </>
            )}
            <h2>Skills</h2>
            {d.skills.length ? (
              d.skills.map((g) => (
                <div key={g.id}>
                  {g.category && <div className="label">{g.category}</div>}
                  <div>
                    {g.items.map((i) => (
                      <span className="chip" key={i}>
                        {i}
                      </span>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">No skills section detected.</p>
            )}
            <h2>Education</h2>
            {d.education.map((e) => (
              <div key={e.id}>
                <strong>{e.institution}</strong>
                <div className="muted small">
                  {[e.degree, e.field].filter(Boolean).join(', ')} {e.dateText && `· ${e.dateText}`}
                </div>
              </div>
            ))}
            {d.certifications.length > 0 && (
              <>
                <h2>Certifications</h2>
                {d.certifications.map((c) => (
                  <div key={c.id}>{[c.name, c.issuer, c.date].filter(Boolean).join(' · ')}</div>
                ))}
              </>
            )}
          </div>
          <div className="card stack">
            <h2>Experience</h2>
            {d.experience.map((e) => (
              <div key={e.id}>
                <div className="spread">
                  <strong>
                    {e.title}
                    {e.company && <span className="muted"> · {e.company}</span>}
                  </strong>
                  <span className="muted small">{e.dateText || [formatDateForDisplay(e.startDate), formatDateForDisplay(e.endDate)].filter(Boolean).join(' – ')}</span>
                </div>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {e.bullets.map((b) => (
                    <li key={b.id}>{b.text}</li>
                  ))}
                </ul>
              </div>
            ))}
            {d.projects.length > 0 && <h2>Projects</h2>}
            {d.projects.map((p) => (
              <div key={p.id}>
                <strong>{p.name}</strong> {p.url && <span className="muted small">{p.url}</span>}
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {p.bullets.map((b) => (
                    <li key={b.id}>{b.text}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="muted small">
        Something parsed incorrectly? <Link to="/profile">Edit your profile</Link> — the optimizer uses your resume text as the only source of truth, so fix the source file for best results.
      </p>
    </div>
  );
}
