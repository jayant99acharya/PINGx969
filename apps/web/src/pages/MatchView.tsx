import type { MatchResult, SkillAssessment } from '@pingx969/shared';
import { BarList } from '../charts';
import { ScoreRing } from '../ui';

const STATUS_LABEL: Record<SkillAssessment['status'], string> = { matched: 'Matched', partial: 'Partially matched', transferable: 'Potentially transferable', missing: 'Missing' };

export function SkillBuckets({ skills }: { skills: SkillAssessment[] }) {
  const order: SkillAssessment['status'][] = ['matched', 'partial', 'transferable', 'missing'];
  return (
    <div className="grid grid-2" style={{ gap: 12 }}>
      {order.map((st) => {
        const list = skills.filter((s) => s.status === st);
        return (
          <div key={st}>
            <div className="label" style={{ marginBottom: 4 }}>
              {STATUS_LABEL[st]} ({list.length})
            </div>
            {list.length ? (
              list.map((s) => (
                <span
                  key={s.skill}
                  className={`chip ${st === 'matched' ? 'added' : st === 'missing' ? 'missing' : 'partial'}`}
                  title={[s.required ? 'Required' : 'Preferred', s.via ? `via ${s.via}` : '', s.evidence[0] ?? ''].filter(Boolean).join(' · ')}
                >
                  {st === 'matched' ? '✓' : st === 'missing' ? '✕' : '~'} {s.skill}
                  {!s.required && <span className="muted"> (pref.)</span>}
                </span>
              ))
            ) : (
              <span className="muted small">None</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function MatchView({ match, compareTo, title = 'Job match' }: { match: MatchResult; compareTo?: MatchResult; title?: string }) {
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 18, alignItems: 'center' }}>
        <ScoreRing value={match.overall} label={title} />
        <div>
          <h2>
            {title}: {match.overall}%
          </h2>
          {compareTo && (
            <p className="muted">
              Before optimization: {compareTo.overall}% ({match.overall - compareTo.overall >= 0 ? '+' : ''}
              {match.overall - compareTo.overall} points)
            </p>
          )}
          <p className="muted small" style={{ maxWidth: 560 }}>
            {match.methodology}
          </p>
        </div>
      </div>
      <BarList
        label="Score by dimension"
        max={100}
        unit="%"
        items={match.dimensions.map((d) => ({ label: `${d.label}${d.applicable ? '' : ' (n/a)'}`, value: d.applicable ? d.score : null, note: `weight ${d.weight} · ${d.summary}` }))}
      />
      <details>
        <summary className="label">Why these scores?</summary>
        <div className="stack" style={{ marginTop: 10 }}>
          {match.dimensions.map((d) => (
            <div key={d.key}>
              <strong>
                {d.label} — {d.applicable ? `${d.score}%` : 'not applicable'}
              </strong>{' '}
              <span className="muted small">(weight {d.weight})</span>
              <div className="muted small">{d.summary}</div>
              <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {d.details.slice(0, 12).map((x, i) => (
                  <li key={i}>
                    <span aria-label={x.status}>{x.status === 'pass' ? '✓' : x.status === 'fail' ? '✕' : x.status === 'partial' ? '~' : '•'}</span> {x.label}
                    {x.note && <span className="muted"> — {x.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
