import { useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, fmtDate } from '../api';
import { Empty, ErrorBox, Icon, Loading, ScorePill, useLoad, useToast, errMsg } from '../ui';
import type { ResumeRow, VersionRow } from '../types';

export function UploadResume({ onUploaded, compact }: { onUploaded: (id: string) => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();
  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Files must be 5 MB or smaller.');
      const form = new FormData();
      form.append('file', file);
      const r = await api<{ resume: ResumeRow; warnings: string[]; profileUpdated: boolean }>('/resumes', { form });
      toast(r.profileUpdated ? 'Resume parsed — your profile was filled in from it.' : 'Resume uploaded and parsed.');
      onUploaded(r.resume.id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) void upload(f);
  };
  return (
    <div className="stack">
      <div
        className={`dropzone${drag ? ' drag' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Upload a resume file"
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        style={compact ? { padding: 18 } : undefined}
      >
        {busy ? (
          <div className="row" style={{ justifyContent: 'center' }}>
            <span className="spinner" /> Parsing your resume…
          </div>
        ) : (
          <>
            <Icon name="upload" />
            <div style={{ fontWeight: 600, marginTop: 6 }}>Drop your resume here or click to browse</div>
            <div className="muted small">PDF, DOCX, TXT, Markdown or JSON (JSON Resume supported) · up to 5 MB</div>
          </>
        )}
      </div>
      <input ref={input} type="file" hidden accept=".pdf,.docx,.txt,.md,.markdown,.json" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} data-testid="resume-file-input" />
      <ErrorBox error={error} />
    </div>
  );
}

export function ResumesPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(async () => {
    const [r, v] = await Promise.all([api<{ resumes: ResumeRow[] }>('/resumes'), api<{ versions: VersionRow[] }>('/versions')]);
    return { resumes: r.resumes, versions: v.versions };
  });
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const { resumes, versions } = data!;

  const remove = async (id: string) => {
    if (!window.confirm('Delete this resume and all of its tailored versions? This cannot be undone.')) return;
    try {
      await api(`/resumes/${id}`, { method: 'DELETE' });
      toast('Resume deleted.');
      void reload();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head">
        <div>
          <h1>Resumes</h1>
          <p>Your original resumes are never modified. Every tailored version is saved separately.</p>
        </div>
      </div>
      {params.get('welcome') && !resumes.length && <div className="alert alert-good">Welcome! Upload your resume to get started.</div>}
      <UploadResume onUploaded={(id) => nav(`/resumes/${id}`)} compact={resumes.length > 0} />
      {resumes.length === 0 ? (
        <div className="card">
          <Empty title="No resumes yet">Upload a resume above. We’ll extract your experience, education and skills into an editable structure.</Empty>
        </div>
      ) : (
        resumes.map((r) => {
          const vs = versions.filter((v) => v.resumeId === r.id);
          return (
            <div className="card" key={r.id}>
              <div className="spread">
                <div>
                  <div className="row">
                    <Link to={`/resumes/${r.id}`} style={{ fontWeight: 600, fontSize: 15 }}>
                      {r.name}
                    </Link>
                    <span className="badge">{r.sourceFormat.toUpperCase()}</span>
                    {r.isDefault && <span className="badge badge-brand">Default</span>}
                  </div>
                  <div className="muted small">Uploaded {fmtDate(r.createdAt)}</div>
                </div>
                <div className="row">
                  <Link className="btn btn-sm" to={`/optimize?resumeId=${r.id}`}>
                    <Icon name="spark" /> Tailor to a job
                  </Link>
                  <button className="btn btn-sm btn-danger" onClick={() => void remove(r.id)} aria-label={`Delete ${r.name}`}>
                    <Icon name="trash" />
                  </button>
                </div>
              </div>
              <ul className="tree" aria-label={`Versions of ${r.name}`}>
                <li>
                  <Link to={`/resumes/${r.id}`}>Original</Link> <span className="muted small">— never modified</span>
                </li>
                {vs.map((v) => (
                  <li key={v.id}>
                    <div className="spread">
                      <Link to={`/versions/${v.id}`}>{v.label}</Link>
                      <span className="row small">
                        <span className="muted">
                          {v.matchBefore}% →
                        </span>
                        <ScorePill value={v.matchAfter} />
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </div>
  );
}
