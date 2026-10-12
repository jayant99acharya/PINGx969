import { Link } from 'react-router-dom';
import { ApplicationStatusLabels, ApplicationStatuses, type ApplicationStatus } from '@pingx969/shared';
import { api, fmtDate } from '../api';
import { BarList, Columns } from '../charts';
import { Empty, ErrorBox, Icon, Loading, ScorePill, StatusBadge, useLoad } from '../ui';
import type { ApplicationRow, VersionRow } from '../types';

interface DashboardData {
  stats: {
    total: number;
    thisWeek: number;
    averageMatch: number | null;
    averageResumeMatch: number | null;
    interviewRate: number | null;
    submitted: number;
    interviews: number;
    byStatus: Record<string, number>;
    weekly: { week: string; count: number }[];
    resumes: number;
    versions: number;
    savedAnswers: number;
  };
  recentApplications: ApplicationRow[];
  recentVersions: VersionRow[];
}

function lastWeeks(weekly: { week: string; count: number }[]) {
  const out: { label: string; value: number }[] = [];
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  for (let i = 7; i >= 0; i--) {
    const d = new Date(monday);
    d.setDate(monday.getDate() - i * 7);
    const key = d.toISOString().slice(0, 10);
    const hit = weekly.find((w) => w.week === key);
    out.push({ label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), value: hit?.count ?? 0 });
  }
  return out;
}

export function DashboardPage() {
  const { data, error, loading, reload } = useLoad(() => api<DashboardData>('/dashboard'));
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const d = data!;
  const s = d.stats;
  const isNew = s.resumes === 0;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Your job search at a glance.</p>
        </div>
        <div className="row">
          <Link className="btn" to="/applications">
            <Icon name="plus" /> Track application
          </Link>
          <Link className="btn btn-primary" to="/optimize">
            <Icon name="spark" /> Optimize for a job
          </Link>
        </div>
      </div>

      {isNew && (
        <div className="card">
          <Empty title="Start by uploading your resume" action={<Link className="btn btn-primary" to="/resumes">Upload resume</Link>}>
            We’ll parse it into your profile, then you can tailor it to any job description and autofill applications with the browser extension.
          </Empty>
        </div>
      )}

      <div className="grid grid-4">
        <div className="card tile">
          <div className="label">Applications</div>
          <div className="value">{s.total}</div>
          <div className="hint">{s.submitted} submitted</div>
        </div>
        <div className="card tile">
          <div className="label">This week</div>
          <div className="value">{s.thisWeek}</div>
          <div className="hint">new in the last 7 days</div>
        </div>
        <div className="card tile">
          <div className="label">Average resume match</div>
          <div className="value">{s.averageResumeMatch == null ? '—' : `${s.averageResumeMatch}%`}</div>
          <div className="hint">across {s.versions} tailored version{s.versions === 1 ? '' : 's'}</div>
        </div>
        <div className="card tile">
          <div className="label">Interview rate</div>
          <div className="value">{s.interviewRate == null ? '—' : `${s.interviewRate}%`}</div>
          <div className="hint">{s.interviews} of {s.submitted} submitted reached interview or offer</div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <h2>Applications by status</h2>
          </div>
          {s.total ? (
            <BarList label="Applications by status" items={ApplicationStatuses.map((st) => ({ label: ApplicationStatusLabels[st], value: s.byStatus[st] ?? 0 }))} />
          ) : (
            <p className="muted">No applications yet.</p>
          )}
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Applications per week</h2>
            <p>Last 8 weeks</p>
          </div>
          <Columns label="Applications per week, last 8 weeks" items={lastWeeks(s.weekly)} />
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <h2>Recent applications</h2>
            <Link to="/applications">View all</Link>
          </div>
          {d.recentApplications.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Role</th>
                    <th className="num">Match</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {d.recentApplications.map((a) => (
                    <tr key={a.id}>
                      <td>{a.company || '—'}</td>
                      <td>{a.jobTitle || '—'}</td>
                      <td className="num">
                        <ScorePill value={a.matchScore} />
                      </td>
                      <td>
                        <StatusBadge status={a.status as ApplicationStatus} />
                      </td>
                      <td className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(a.appliedAt ?? a.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Applications you autofill with the extension appear here automatically.</p>
          )}
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Recent resume versions</h2>
            <Link to="/resumes">View all</Link>
          </div>
          {d.recentVersions.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th className="num">Match</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {d.recentVersions.map((v) => (
                    <tr key={v.id}>
                      <td>
                        <Link to={`/versions/${v.id}`}>{v.label}</Link>
                      </td>
                      <td className="num">
                        <span className="muted small">{v.matchBefore}% → </span>
                        <ScorePill value={v.matchAfter} />
                      </td>
                      <td className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(v.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">
              No tailored versions yet. <Link to="/optimize">Optimize your resume for a job.</Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
