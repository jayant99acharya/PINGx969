import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { JobAnalysis, MatchResult } from '@pingx969/shared';
import { api, fmtDate } from '../api';
import { ErrorBox, Icon, Loading, useLoad, useToast } from '../ui';
import type { JobRow, ResumeRow, SettingsResponse } from '../types';
import { MatchView, SkillBuckets } from './MatchView';
import { UploadResume } from './ResumesPage';

type Source = 'paste' | 'upload' | 'url';

export function OptimizePage() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const base = useLoad(async () => {
    const [r, j, s] = await Promise.all([api<{ resumes: ResumeRow[] }>('/resumes'), api<{ jobs: JobRow[] }>('/jobs'), api<SettingsResponse>('/settings')]);
    return { resumes: r.resumes, jobs: j.jobs, settings: s };
  });
  const [resumeId, setResumeId] = useState(params.get('resumeId') ?? '');
  const [jobId, setJobId] = useState(params.get('jobId') ?? '');
  const [source, setSource] = useState<Source>('paste');
  const [text, setText] = useState('');
  const [url, setUrl] = useState(params.get('url') ?? '');
  const [title, setTitle] = useState(params.get('title') ?? '');
  const [company, setCompany] = useState(params.get('company') ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<'job' | 'match' | 'optimize' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [analysis, setAnalysis] = useState<JobAnalysis | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [provider, setProvider] = useState('');
  const [consent, setConsent] = useState(false);
  const [scope, setScope] = useState<'skills' | 'full'>(() => {
    try {
      return (localStorage.getItem('px-scope') as 'skills' | 'full') || 'skills';
    } catch {
      return 'skills';
    }
  });
  const chooseScope = (s: 'skills' | 'full') => {
    setScope(s);
    try {
      localStorage.setItem('px-scope', s);
    } catch {
      /* storage unavailable */
    }
  };
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!base.data) return;
    if (!resumeId && base.data.resumes.length) setResumeId((base.data.resumes.find((r) => r.isDefault) ?? base.data.resumes[0]).id);
    if (!provider) setProvider(base.data.settings.settings.aiProvider);
  }, [base.data, resumeId, provider]);

  // Selecting an existing job loads its analysis + match.
  useEffect(() => {
    if (!jobId || !resumeId) return;
    let alive = true;
    (async () => {
      setBusy('match');
      setError(null);
      try {
        const j = await api<{ job: JobRow }>(`/jobs/${jobId}`);
        const m = await api<{ match: MatchResult }>(`/resumes/${resumeId}/match`, { body: { jobId } });
        if (!alive) return;
        setAnalysis(j.job.description?.analysis ?? null);
        setMatch(m.match);
        setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      } catch (e) {
        if (alive) setError(e);
      } finally {
        if (alive) setBusy(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [jobId, resumeId]);

  if (base.loading && !base.data) return <Loading />;
  if (base.error) return <ErrorBox error={base.error} onRetry={base.reload} />;
  const { resumes, jobs, settings } = base.data!;
  const providerInfo = settings.providers.find((p) => p.name === provider);

  const analyze = async () => {
    setBusy('job');
    setError(null);
    setWarnings([]);
    try {
      let res: { job: JobRow; analysis: JobAnalysis; warnings: string[] };
      if (source === 'upload') {
        if (!file) throw new Error('Choose a job description file.');
        const form = new FormData();
        form.append('file', file);
        form.append('title', title);
        form.append('company', company);
        form.append('url', url);
        res = await api('/jobs', { form });
      } else if (source === 'url') {
        if (!url.trim()) throw new Error('Enter the job posting URL.');
        res = await api('/jobs', { body: { url, title, company, fetchUrl: true, text } });
      } else {
        if (!text.trim()) throw new Error('Paste the job description first.');
        res = await api('/jobs', { body: { text, url, title, company } });
      }
      setWarnings(res.warnings);
      setJobId(res.job.id);
      setParams((p) => {
        p.set('jobId', res.job.id);
        if (resumeId) p.set('resumeId', resumeId);
        return p;
      });
      base.setData((d) => (d ? { ...d, jobs: [res.job, ...d.jobs] } : d));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const optimize = async () => {
    setBusy('optimize');
    setError(null);
    try {
      const external = !!providerInfo?.external && scope === 'full';
      const r = await api<{ version: { id: string } }>('/versions', { body: { resumeId, jobId, provider: scope === 'skills' ? 'heuristic' : provider, consentExternal: external ? consent : undefined, scope } });
      toast('Optimized version created. Review each change below.');
      nav(`/versions/${r.version.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  if (!resumes.length) {
    return (
      <div className="stack">
        <div className="page-head">
          <div>
            <h1>Optimize for a job</h1>
            <p>First, upload the resume you want to tailor.</p>
          </div>
        </div>
        <UploadResume onUploaded={(id) => { setResumeId(id); void base.reload(); }} />
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head">
        <div>
          <h1>Optimize for a job</h1>
          <p>We only emphasize what’s already true in your resume — nothing is invented.</p>
        </div>
      </div>

      <div className="card stack">
        <h2>1. Resume</h2>
        <div className="field" style={{ maxWidth: 480 }}>
          <label htmlFor="resume-select">Base resume</label>
          <select id="resume-select" className="input" value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
            {resumes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.sourceFormat.toUpperCase()})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card stack">
        <div className="spread">
          <h2>2. Job description</h2>
          {jobs.length > 0 && (
            <select className="input" style={{ maxWidth: 360 }} aria-label="Use a saved job" value="" onChange={(e) => e.target.value && setJobId(e.target.value)}>
              <option value="">Or pick a saved job…</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {[j.company, j.title].filter(Boolean).join(' — ') || 'Untitled job'} · {fmtDate(j.createdAt)}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="tabs" role="tablist" aria-label="Job description source">
          {(['paste', 'upload', 'url'] as Source[]).map((s) => (
            <button key={s} className="tab" role="tab" aria-selected={source === s} onClick={() => setSource(s)}>
              {s === 'paste' ? 'Paste text' : s === 'upload' ? 'Upload file' : 'From URL'}
            </button>
          ))}
        </div>
        {source === 'paste' && (
          <div className="field">
            <label htmlFor="jd-text">Job description</label>
            <textarea id="jd-text" className="input" style={{ minHeight: 220 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the full job description, including requirements and responsibilities…" />
          </div>
        )}
        {source === 'upload' && (
          <div className="field">
            <label htmlFor="jd-file">Job description file (PDF, DOCX, TXT, MD)</label>
            <input id="jd-file" type="file" accept=".pdf,.docx,.txt,.md" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
        )}
        <div className="form-grid">
          <div className="field">
            <label htmlFor="jd-url">Job URL {source === 'url' ? '' : '(optional)'}</label>
            <input id="jd-url" className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </div>
          <div className="field">
            <label htmlFor="jd-title">Job title (optional)</label>
            <input id="jd-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="jd-company">Company (optional)</label>
            <input id="jd-company" className="input" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
        </div>
        {source === 'url' && <p className="help">We fetch public pages only (private network addresses are blocked). If a site blocks us, paste the text instead.</p>}
        <div>
          <button className="btn btn-primary" onClick={() => void analyze()} disabled={busy !== null}>
            {busy === 'job' ? 'Analyzing…' : 'Analyze job & score my resume'}
          </button>
        </div>
      </div>

      <ErrorBox error={error} />
      {warnings.map((w) => (
        <div className="alert alert-warn" key={w}>
          {w}
        </div>
      ))}
      {busy === 'match' && <Loading text="Scoring your resume…" />}

      {analysis && match && (
        <div ref={resultRef} className="stack" style={{ gap: 18 }}>
          <div className="grid grid-2">
            <div className="card stack">
              <h2>Job analysis</h2>
              <div>
                <strong>{analysis.title || 'Untitled role'}</strong>
                {analysis.company && <span className="muted"> · {analysis.company}</span>}
              </div>
              <div className="row small">
                {analysis.seniority !== 'unknown' && <span className="badge">{analysis.seniority}</span>}
                {analysis.yearsExperience.min !== null && <span className="badge">{analysis.yearsExperience.min}+ years</span>}
                {analysis.education.level !== 'none' && <span className="badge">{analysis.education.level} degree{analysis.education.equivalentExperienceOk ? ' or equivalent' : ''}</span>}
                {analysis.workArrangement !== 'unknown' && <span className="badge">{analysis.workArrangement}</span>}
                {analysis.location && <span className="badge">{analysis.location}</span>}
                {analysis.salary && <span className="badge">{analysis.salary}</span>}
              </div>
              <div>
                <div className="label">Required skills</div>
                {analysis.requiredSkills.map((s) => (
                  <span className="chip" key={s}>
                    {s}
                  </span>
                ))}
              </div>
              {analysis.preferredSkills.length > 0 && (
                <div>
                  <div className="label">Preferred skills</div>
                  {analysis.preferredSkills.map((s) => (
                    <span className="chip" key={s}>
                      {s}
                    </span>
                  ))}
                </div>
              )}
              {analysis.domains.length > 0 && (
                <div className="small">
                  <span className="label">Domain: </span>
                  {analysis.domains.join(', ')}
                </div>
              )}
              <details>
                <summary className="label">Responsibilities ({analysis.responsibilities.length})</summary>
                <ul className="small">
                  {analysis.responsibilities.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </details>
              {analysis.otherRequirements.length > 0 && (
                <details>
                  <summary className="label">Other requirements</summary>
                  <ul className="small">
                    {analysis.otherRequirements.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
            <div className="card">
              <MatchView match={match} title="Current match" />
            </div>
          </div>
          <div className="card stack">
            <h2>Skills</h2>
            <SkillBuckets skills={match.skills} />
          </div>
          <div className="card stack">
            <h2>3. Generate optimized resume</h2>
            <p className="muted">
              Creates a new version — your original stays untouched. You’ll review every change (accept, reject or edit) before downloading.
            </p>
            <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
              <legend className="label" style={{ marginBottom: 6 }}>What should change?</legend>
              <label className="checkbox">
                <input type="radio" name="scope" checked={scope === 'skills'} onChange={() => chooseScope('skills')} />
                <span>
                  <strong>Skills only</strong> — keep everything exactly as written and only add job skills to the end of your Skills section.
                  <div className="help">PDF and Word downloads keep your original file’s design.</div>
                </span>
              </label>
              <label className="checkbox">
                <input type="radio" name="scope" checked={scope === 'full'} onChange={() => chooseScope('full')} />
                <span>
                  <strong>Full tailoring</strong> — also reorder skills and bullets, rephrase bullets and write a job-specific summary.
                  <div className="help">PDF downloads are re-rendered in your layout (Word files are still edited in place).</div>
                </span>
              </label>
            </fieldset>
            {scope === 'full' && <div className="form-grid">
              <div className="field">
                <label htmlFor="provider">Optimization engine</label>
                <select id="provider" className="input" value={provider} onChange={(e) => setProvider(e.target.value)}>
                  {settings.providers.map((p) => (
                    <option key={p.name} value={p.name} disabled={!p.available}>
                      {p.name === 'heuristic' ? 'Built-in (private, runs on this server)' : `Claude (${p.model})${p.available ? '' : ' — not configured'}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>}
            {scope === 'full' && providerInfo?.external && (
              <label className="checkbox alert">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>
                  I understand my resume content (with name, email, phone, address and links removed) and this job description will be sent to Anthropic to generate suggestions. Every suggestion is still checked against my resume before it can be applied.
                </span>
              </label>
            )}
            <div>
              <button className="btn btn-primary" onClick={() => void optimize()} disabled={busy !== null || !jobId || (scope === 'full' && !!providerInfo?.external && !consent)}>
                <Icon name="spark" /> {busy === 'optimize' ? 'Generating…' : 'Generate optimized version'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
