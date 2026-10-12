import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Change } from '@pingx969/shared';
import { api, download, fmtDate } from '../api';
import { ErrorBox, Icon, Loading, ProvenanceBadge, ScorePill, useLoad, useToast, errMsg } from '../ui';
import type { VersionDetail } from '../types';
import { MatchView, SkillBuckets } from './MatchView';
import { DocPreview } from './Preview';

type Tab = 'changes' | 'preview' | 'match';

export function VersionPage() {
  const { id } = useParams();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('changes');
  const [saving, setSaving] = useState<string | null>(null);
  const { data, setData, error, loading, reload } = useLoad(() => api<VersionDetail>(`/versions/${id}`), [id]);

  const bulletText = useMemo(() => {
    const m = new Map<string, string>();
    const o = data?.payload.optimized;
    o?.experience.forEach((e) => e.bullets.forEach((b) => m.set(b.id, b.text)));
    o?.projects.forEach((p) => p.bullets.forEach((b) => m.set(b.id, b.text)));
    return m;
  }, [data?.payload.optimized]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const v = data!;
  const changes = v.payload.changes;

  const decide = async (changeId: string, decision: { accepted?: boolean; after?: string | string[]; confirmSkill?: boolean }) => {
    setSaving(changeId);
    try {
      const r = await api<{ payload: VersionDetail['payload']; placeholders: number }>(`/versions/${id}`, { method: 'PATCH', body: { decisions: [{ id: changeId, ...decision }] } });
      setData((d) => (d ? { ...d, payload: r.payload, placeholders: r.placeholders, version: { ...d.version, matchAfter: r.payload.matchAfter.overall, updatedAt: new Date().toISOString() } } : d));
      if (decision.confirmSkill) toast('Skill added and saved to your profile as confirmed.');
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setSaving(null);
    }
  };
  const decideMany = async (decisions: { id: string; accepted?: boolean; confirmSkill?: boolean }[]) => {
    setSaving('bulk');
    try {
      const r = await api<{ payload: VersionDetail['payload']; placeholders: number }>(`/versions/${id}`, { method: 'PATCH', body: { decisions } });
      setData((d) => (d ? { ...d, payload: r.payload, placeholders: r.placeholders, version: { ...d.version, matchAfter: r.payload.matchAfter.overall, updatedAt: new Date().toISOString() } } : d));
      toast(`Added ${decisions.length} skills and saved them to your profile as confirmed.`);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setSaving(null);
    }
  };
  const bulk = async (accepted: boolean) => {
    const ids = changes.filter((c) => !c.informational && !c.blocked && !c.hasPlaceholder && c.kind !== 'suggestion').map((c) => c.id);
    setSaving('bulk');
    try {
      const r = await api<{ payload: VersionDetail['payload']; placeholders: number }>(`/versions/${id}`, { method: 'PATCH', body: { decisions: ids.map((x) => ({ id: x, accepted })) } });
      setData((d) => (d ? { ...d, payload: r.payload, placeholders: r.placeholders, version: { ...d.version, matchAfter: r.payload.matchAfter.overall, updatedAt: new Date().toISOString() } } : d));
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setSaving(null);
    }
  };

  const fmt = v.resume?.sourceFormat ?? 'pdf';
  const exportFile = async (format: string) => {
    let force = '';
    if (v.placeholders > 0) {
      if (!window.confirm(`This version still has ${v.placeholders} unfilled placeholder(s) like "[add measurable result]". Download anyway?`)) return;
      force = '&force=1';
    }
    await download(`/versions/${id}/export?format=${format}${force}`, `resume.${format}`).catch((e) => toast(errMsg(e), 'error'));
  };

  const by = (kinds: Change['kind'][]) => changes.filter((c) => kinds.includes(c.kind));
  const summary = by(['summary_generated', 'summary_rephrased']);
  const skillChanges = by(['skills_reordered', 'skill_added']);
  const notAdded = by(['skill_not_added']);
  const bullets = by(['bullet_rephrased']);
  const reorders = by(['bullets_reordered']);
  const suggestions = by(['suggestion']);
  const active = changes.filter((c) => !c.informational && c.accepted && !c.blocked).length;
  const blocked = changes.filter((c) => c.blocked).length;
  const previewKey = v.version.updatedAt;
  const skillsOnly = v.payload.metadata?.scope === 'skills';

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head">
        <div>
          <div className="small muted">
            <Link to="/resumes">Resumes</Link> / {v.resume?.name ?? 'Deleted resume'}
          </div>
          <h1>{v.version.label}</h1>
          <p>
            Created {fmtDate(v.version.createdAt)} · engine: {v.payload.provider === 'heuristic' ? 'built-in' : v.payload.provider} ·{' '}
            {v.job?.url ? (
              <a href={v.job.url} target="_blank" rel="noreferrer noopener">
                job posting
              </a>
            ) : (
              'no job URL'
            )}
          </p>
        </div>
        <div className="row" style={{ alignItems: 'center' }}>
          <span className="muted">Match</span>
          <ScorePill value={v.payload.matchBefore.overall} />
          <span aria-hidden="true">→</span>
          <ScorePill value={v.payload.matchAfter.overall} />
        </div>
      </div>

      {v.payload.warnings.map((w) => (
        <div key={w} className="alert alert-warn">
          {w}
        </div>
      ))}
      {v.placeholders > 0 && (
        <div className="alert alert-warn">
          {v.placeholders} accepted suggestion(s) still contain a placeholder like “[add measurable result]”. Replace it with a real number or reject the suggestion before exporting.
        </div>
      )}

      <div className="card">
        <div className="spread">
          <div>
            <strong>Download optimized resume</strong>
            <div className="muted small">{active} change(s) applied{blocked ? ` · ${blocked} blocked by fact-checking` : ''}</div>
          </div>
          <div className="row">
            {v.capabilities.map((c) => (
              <button key={c.format} className={`btn btn-sm${c.format === fmt ? ' btn-primary' : ''}`} onClick={() => void exportFile(c.format)} title={c.note}>
                <Icon name="download" /> {c.format.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <ul className="small muted" style={{ margin: '10px 0 0', paddingLeft: 18 }}>
          {v.capabilities.map((c) => (
            <li key={c.format}>
              <strong>{c.format.toUpperCase()}</strong>: {c.note}
            </li>
          ))}
        </ul>
      </div>

      <div className="tabs" role="tablist">
        {(['changes', 'preview', 'match'] as Tab[]).map((t) => (
          <button key={t} className="tab" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === 'changes' ? `Changes (${changes.filter((c) => !c.informational).length})` : t === 'preview' ? 'Original vs optimized' : 'Match details'}
          </button>
        ))}
      </div>

      {tab === 'changes' && (
        <div className="stack" style={{ gap: 18 }}>
          <div className="row">
            <button className="btn btn-sm" disabled={saving !== null} onClick={() => void bulk(true)}>
              Accept all
            </button>
            <button className="btn btn-sm" disabled={saving !== null} onClick={() => void bulk(false)}>
              Reject all
            </button>
            <span className="muted small">Suggestions with placeholders are never applied until you fill them in.</span>
          </div>

          {summary.length > 0 && (
            <Section title="Summary">
              {summary.map((c) => (
                <ChangeCard key={c.id} c={c} saving={saving === c.id} onDecide={decide} editable />
              ))}
            </Section>
          )}

          <Section title="Skills">
            {skillChanges.map((c) => (
              <ChangeCard key={c.id} c={c} saving={saving === c.id} onDecide={decide} />
            ))}
            {notAdded.length > 0 && (
              <div className="change">
                <div className="spread">
                  <strong>Not added</strong>
                  <span className="badge badge-bad">Not in your resume</span>
                </div>
                <p className="muted small" style={{ margin: '4px 0 8px' }}>
                  These job requirements were not found in your resume, so they were not added. If you genuinely have one, confirm it and it will be added (and remembered in your profile).
                </p>
                <div style={{ marginBottom: 10 }}>
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={saving !== null}
                    onClick={() =>
                      window.confirm(`Add all ${notAdded.length} job skills to your Skills section?\n\n${notAdded.map((c) => c.target.skill).join(', ')}\n\nOnly continue if you have real experience with each of them — you can still remove any one afterwards.`) &&
                      void decideMany(notAdded.map((c) => ({ id: c.id, confirmSkill: true })))
                    }
                  >
                    Add all {notAdded.length} job skills
                  </button>
                </div>
                <div className="stack" style={{ gap: 8 }}>
                  {notAdded.map((c) => (
                    <div key={c.id} className="spread">
                      <div>
                        <span className="chip missing">{c.target.skill}</span> <span className="small muted">{c.reason}</span>
                      </div>
                      <button className="btn btn-sm" disabled={saving === c.id} onClick={() => window.confirm(`Only confirm if you have real experience with ${c.target.skill}. Add it?`) && void decide(c.id, { confirmSkill: true })}>
                        I have this skill
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Section>

          {bullets.length > 0 && (
            <Section title="Rephrased experience">
              {bullets.map((c) => (
                <ChangeCard key={c.id} c={c} saving={saving === c.id} onDecide={decide} editable />
              ))}
            </Section>
          )}

          {reorders.length > 0 && (
            <Section title="Prioritized bullets">
              {reorders.map((c) => (
                <ChangeCard key={c.id} c={c} saving={saving === c.id} onDecide={decide} orderTexts={c.target.order?.map((x) => bulletText.get(x) ?? '')} />
              ))}
            </Section>
          )}

          {suggestions.length > 0 && (
            <Section title="Suggestions (need your input)">
              {suggestions.map((c) => (
                <ChangeCard key={c.id} c={c} saving={saving === c.id} onDecide={decide} editable />
              ))}
            </Section>
          )}
        </div>
      )}

      {tab === 'preview' && v.resume && (
        <div className="grid grid-2">
          <div className="card stack">
            <div className="spread">
              <h2>Original</h2>
              <span className="badge">unchanged</span>
            </div>
            <DocPreview path={`/resumes/${v.resume.id}/original`} kind={fmt === 'pdf' ? 'pdf' : fmt === 'docx' ? 'docx' : 'text'} title="Original resume" />
          </div>
          <div className="card stack">
            <div className="spread">
              <h2>Optimized</h2>
              <span className="badge badge-good">{fmt === 'docx' || fmt === 'txt' || fmt === 'md' || skillsOnly ? 'same file, edited in place' : 'same layout'}</span>
            </div>
            <DocPreview
              key={previewKey}
              path={`/versions/${id}/export?format=${fmt === 'json' ? 'pdf' : fmt}&force=1&inline=1&v=${encodeURIComponent(previewKey)}`}
              kind={fmt === 'docx' ? 'docx' : fmt === 'txt' || fmt === 'md' ? 'text' : 'pdf'}
              title="Optimized resume"
            />
          </div>
        </div>
      )}

      {tab === 'match' && (
        <div className="stack">
          <div className="card">
            <MatchView match={v.payload.matchAfter} compareTo={v.payload.matchBefore} title="Optimized match" />
          </div>
          <div className="card stack">
            <h2>Skills</h2>
            <SkillBuckets skills={v.payload.matchAfter.skills} />
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="stack" style={{ gap: 10 }}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

const KIND_LABEL: Record<Change['kind'], string> = {
  skills_reordered: 'Prioritized',
  skill_added: 'Added',
  skill_not_added: 'Not added',
  bullet_rephrased: 'Rephrased',
  bullets_reordered: 'Reordered',
  summary_generated: 'Added summary',
  summary_rephrased: 'Rewrote summary',
  suggestion: 'Suggestion',
};

function ChangeCard({ c, onDecide, saving, editable, orderTexts }: { c: Change; onDecide: (id: string, d: { accepted?: boolean; after?: string }) => Promise<void>; saving: boolean; editable?: boolean; orderTexts?: string[] }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(typeof c.after === 'string' ? c.after : '');
  const before = c.before;
  const after = c.after;
  return (
    <div className={`change${!c.accepted ? ' rejected' : ''}${c.blocked ? ' blocked' : ''}`} data-change-id={c.id}>
      <div className="spread" style={{ marginBottom: 8 }}>
        <div className="row">
          <strong>{KIND_LABEL[c.kind]}</strong>
          <ProvenanceBadge p={c.provenance} />
          {c.edited && <span className="badge">Edited by you</span>}
          {c.source !== 'heuristic' && <span className="badge">AI</span>}
        </div>
        <div className="row">
          {editable && typeof after === 'string' && !editing && (
            <button className="btn btn-sm btn-ghost" onClick={() => setEditing(true)} aria-label="Edit this change">
              <Icon name="edit" /> Edit
            </button>
          )}
          {!c.blocked && (
            <label className="checkbox small">
              <input type="checkbox" checked={c.accepted} disabled={saving || (c.hasPlaceholder && !c.accepted && c.kind === 'suggestion')} onChange={(e) => void onDecide(c.id, { accepted: e.target.checked })} />
              {c.accepted ? 'Accepted' : 'Rejected'}
            </label>
          )}
        </div>
      </div>
      {c.blocked && <div className="alert alert-error small" style={{ marginBottom: 8 }}>{c.blocked} You can edit the text to use your own wording.</div>}
      {c.kind === 'skills_reordered' && Array.isArray(before) && Array.isArray(after) ? (
        <div className="small">
          <div className="muted">Before</div>
          <div>{before.map((s) => <span className="chip" key={s}>{s}</span>)}</div>
          <div className="muted" style={{ marginTop: 6 }}>After</div>
          <div>{after.map((s, i) => <span className={`chip${before.indexOf(s) !== i ? ' partial' : ''}`} key={s}>{s}</span>)}</div>
        </div>
      ) : c.kind === 'skill_added' ? (
        <div>
          <span className="chip added">+ {String(after)}</span>
        </div>
      ) : c.kind === 'bullets_reordered' ? (
        <ol className="small" style={{ margin: 0, paddingLeft: 20 }}>
          {(orderTexts ?? (after as string[])).map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ol>
      ) : editing ? (
        <div className="stack" style={{ gap: 8 }}>
          {typeof before === 'string' && <div className="diff-old small">{before}</div>}
          <textarea className="input" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Edited text" />
          {/\[[^\]]+\]/.test(draft) && <span className="help">Replace the [placeholder] with a real, verifiable detail.</span>}
          <div className="row">
            <button className="btn btn-sm btn-primary" disabled={saving || !draft.trim()} onClick={() => void onDecide(c.id, { after: draft, accepted: true }).then(() => setEditing(false))}>
              Save & accept
            </button>
            <button className="btn btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="stack" style={{ gap: 6 }}>
          {typeof before === 'string' && <div className="diff-old small">{before}</div>}
          {typeof after === 'string' && <div className="diff-new small">{renderPlaceholders(after)}</div>}
        </div>
      )}
      <div className="small muted" style={{ marginTop: 8 }}>
        {c.reason}
      </div>
      {c.evidence.length > 0 && (
        <details>
          <summary className="small muted">Evidence from your resume ({c.evidence.length})</summary>
          {c.evidence.map((e, i) => (
            <div className="evidence" key={i}>
              {e}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

function renderPlaceholders(text: string) {
  const parts = text.split(/(\[[^\]]+\])/g);
  return parts.map((p, i) => (/^\[.*\]$/.test(p) ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>));
}

