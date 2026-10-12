import { useState } from 'react';

/**
 * Single-series horizontal bar list. One hue (--series-1), values labeled in text ink at the
 * bar end, bars grow from one baseline, hover shows an exact tooltip. The value column doubles
 * as the accessible table view.
 */
export function BarList({ items, max, unit = '', label }: { items: { label: string; value: number | null; note?: string }[]; max?: number; unit?: string; label: string }) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value ?? 0));
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="bars" role="table" aria-label={label}>
      {items.map((it, i) => (
        <div
          key={it.label}
          className={`bar-row${it.value == null ? ' na' : ''}`}
          role="row"
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(null)}
          title={it.note}
        >
          <span className="bar-label" role="rowheader">
            {it.label}
          </span>
          <div className="bar-track" aria-hidden="true">
            <div className="bar-fill" style={{ width: `${((it.value ?? 0) / top) * 100}%`, maxHeight: 24 }} />
            {hover === i && it.value != null && (
              <div className="tooltip" style={{ left: `${Math.min(92, Math.max(8, ((it.value ?? 0) / top) * 100))}%`, top: -4 }}>
                {it.label}: {it.value}
                {unit}
                {it.note ? ` — ${it.note}` : ''}
              </div>
            )}
          </div>
          <span className="bar-value" role="cell">
            {it.value == null ? 'n/a' : `${it.value}${unit}`}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Single-series column chart for a short time series (e.g. weekly applications). */
export function Columns({ items, label }: { items: { label: string; value: number }[]; label: string }) {
  const top = Math.max(1, ...items.map((i) => i.value));
  const [hover, setHover] = useState<number | null>(null);
  return (
    <figure style={{ margin: 0 }} aria-label={label}>
      <div className="cols">
        {items.map((it, i) => (
          <div key={it.label} className="col" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            {hover === i && (
              <div className="tooltip" style={{ left: '50%', top: `${100 - (it.value / top) * 85 - 4}%` }}>
                Week of {it.label}: {it.value}
              </div>
            )}
            {it.value > 0 && <span className="col-value">{it.value}</span>}
            <div className="col-fill" style={{ height: `${(it.value / top) * 85}%` }} />
          </div>
        ))}
      </div>
      <div className="col-axis" aria-hidden="true">
        {items.map((it) => (
          <span key={it.label}>{it.label}</span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {items.map((it) => (
            <tr key={it.label}>
              <th>{it.label}</th>
              <td>{it.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
