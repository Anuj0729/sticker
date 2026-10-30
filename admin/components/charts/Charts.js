'use client';
// Dependency-free SVG charts for the Analytics tab.
//
//   TimeChart  stacked bars / line / area over time or categories, optional second line on a 0-100 % axis
//              (used for "success rate"), clickable legend, floating tooltip, works with mouse and touch
//   Sparkline  tiny trend line for KPI cards
//   Ring       circular gauge (a single percentage)
//   Donut      donut / pie with a legend
//   HBars      ranked horizontal bars
//   Seg        small segmented switch (Bar / Line / Area ...)
//
// Colours come from the CSS variables in globals.css, so every chart follows light and dark mode.
import { useId, useState } from 'react';

const n = (v) => Number(v || 0).toLocaleString();
export const compact = (v) => {
  const a = Math.abs(v);
  if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${+(v / 1e3).toFixed(1)}k`;
  return String(Math.round(v * 10) / 10);
};
// 1, 2, 5, 10 ... x 10^k: a "round" axis step
const nice = (v) => { if (v <= 0) return 1; const e = 10 ** Math.floor(Math.log10(v)); const m = v / e; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * e; };
const f1 = (x) => +x.toFixed(1);

// Smooth curve through points without overshooting (monotone cubic). pts: [[x, y], ...]
function smooth(pts) {
  const k = pts.length;
  if (!k) return '';
  if (k === 1) return `M${f1(pts[0][0])},${f1(pts[0][1])}`;
  const dx = [], m = [], t = [];
  for (let i = 0; i < k - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
  t[0] = m[0]; t[k - 1] = m[k - 2];
  for (let i = 1; i < k - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < k - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const r = 3 / Math.sqrt(s); t[i] = r * a * m[i]; t[i + 1] = r * b * m[i]; }
  }
  let d = `M${f1(pts[0][0])},${f1(pts[0][1])}`;
  for (let i = 0; i < k - 1; i++) {
    d += ` C${f1(pts[i][0] + dx[i] / 3)},${f1(pts[i][1] + (t[i] * dx[i]) / 3)} ${f1(pts[i + 1][0] - dx[i] / 3)},${f1(pts[i + 1][1] - (t[i + 1] * dx[i]) / 3)} ${f1(pts[i + 1][0])},${f1(pts[i + 1][1])}`;
  }
  return d;
}
// Splits [[x, y|null]] into runs without gaps (a day with no data breaks the line instead of dropping to 0)
const runs = (pts) => { const out = []; let cur = []; pts.forEach((p) => { if (p[1] == null) { if (cur.length) out.push(cur); cur = []; } else cur.push(p); }); if (cur.length) out.push(cur); return out; };
// Bar with only its top corners rounded
const barPath = (x, y, w, h, r) => {
  r = Math.max(0, Math.min(r, w / 2, h));
  return `M${f1(x)},${f1(y + h)} L${f1(x)},${f1(y + r)} Q${f1(x)},${f1(y)} ${f1(x + r)},${f1(y)} L${f1(x + w - r)},${f1(y)} Q${f1(x + w)},${f1(y)} ${f1(x + w)},${f1(y + r)} L${f1(x + w)},${f1(y + h)} Z`;
};

// ---------- time / category chart ----------
// points: [{ label, tip, values: { key: number }, rate?: 0..1 | null }]
// series: [{ key, label, color }]      line: { label, color } (draws p.rate on a 0-100 % axis on the right)
export function TimeChart({ points, series, kind = 'bar', height = 280, labelEvery, ariaLabel, line, highlightMax = false, empty = 'No data for this period.', legend = true }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [hover, setHover] = useState(null);
  const [off, setOff] = useState(() => new Set());
  if (!points.length) return <div className="cx-empty">{empty}</div>;

  const toggle = (k) => setOff((o) => { const x = new Set(o); x.has(k) ? x.delete(k) : x.add(k); return x; });
  const active = series.filter((s) => !off.has(s.key));
  const showLine = !!line && !off.has('__line');

  const W = 900, H = height, L = 46, R = line ? 48 : 12, T = 14, B = 30;
  const total = (p) => active.reduce((a, s) => a + (p.values[s.key] || 0), 0);
  const stacked = kind === 'bar';
  const max = Math.max(...points.map((p) => (stacked ? total(p) : Math.max(0, ...active.map((s) => p.values[s.key] || 0)))), 1);
  const step4 = Math.max(1, nice(max / 4));
  const top = step4 * 4; // 4 equal intervals, so the left axis and the 0-100 % axis share the same grid lines
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const yr = (r) => T + (H - T - B) * (1 - r);
  const step = (W - L - R) / points.length;
  const cx = (i) => L + step * i + step / 2;
  const every = labelEvery || Math.ceil(points.length / 9);
  const barW = Math.min(Math.max(step * 0.64, 2), 46);
  const maxIdx = highlightMax ? points.reduce((b, p, i) => (total(p) > total(points[b]) ? i : b), 0) : -1;
  const dots = points.length <= 31;

  const lineOf = (s) => runs(points.map((p, i) => [cx(i), p.values[s.key] == null ? null : y(p.values[s.key] || 0)]));
  const rateRuns = showLine ? runs(points.map((p, i) => [cx(i), p.rate == null ? null : yr(p.rate)])) : [];
  const hp = hover === null ? null : points[hover];
  const ticks = [0, 1, 2, 3, 4];

  return (
    <div className="cx">
      {legend && (
        <div className="cx-legend" role="group" aria-label="Show or hide series">
          {series.map((s) => (
            <button key={s.key} type="button" className="cx-leg" aria-pressed={!off.has(s.key)} style={{ '--c': s.color }} onClick={() => toggle(s.key)}><i />{s.label}</button>
          ))}
          {line && <button type="button" className="cx-leg" aria-pressed={showLine} style={{ '--c': line.color }} onClick={() => toggle('__line')}><i className="ln" />{line.label}</button>}
        </div>
      )}
      <div className="cx-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} onPointerLeave={() => setHover(null)}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" style={{ stopColor: s.color }} stopOpacity={kind === 'area' ? 0.32 : 1} />
                <stop offset="1" style={{ stopColor: s.color }} stopOpacity={kind === 'area' ? 0.02 : 0.62} />
              </linearGradient>
            ))}
          </defs>

          {ticks.map((i) => (
            <g key={i}>
              <line x1={L} x2={W - R} y1={y(step4 * i)} y2={y(step4 * i)} className={i === 0 ? 'gl base' : 'gl'} />
              <text x={L - 8} y={y(step4 * i) + 4} textAnchor="end" className="ax">{compact(step4 * i)}</text>
              {line && <text x={W - R + 8} y={y(step4 * i) + 4} className="ax">{i * 25}%</text>}
            </g>
          ))}

          {hover !== null && <rect x={L + step * hover} y={T} width={step} height={H - T - B} className="cx-band" />}

          {kind === 'bar' && points.map((p, i) => {
            let acc = 0;
            const lastKey = [...active].reverse().find((s) => p.values[s.key])?.key;
            return (
              <g key={i} opacity={maxIdx >= 0 && i !== maxIdx ? 0.5 : hover === null || hover === i ? 1 : 0.55} className="cx-bargroup">
                {active.map((s) => {
                  const v = p.values[s.key] || 0;
                  if (!v) return null;
                  const y1 = y(acc + v), y0 = y(acc);
                  acc += v;
                  const h = Math.max(y0 - y1 - 1, 1);
                  return <path key={s.key} className="cx-bar" d={barPath(cx(i) - barW / 2, y1, barW, h, s.key === lastKey ? 5 : 0)} fill={`url(#${uid}-${s.key})`} />;
                })}
              </g>
            );
          })}

          {kind !== 'bar' && active.map((s) => (
            <g key={s.key}>
              {lineOf(s).map((r, j) => (
                <g key={j}>
                  {kind === 'area' && r.length > 1 && <path d={`${smooth(r)} L${f1(r[r.length - 1][0])},${f1(y(0))} L${f1(r[0][0])},${f1(y(0))} Z`} fill={`url(#${uid}-${s.key})`} />}
                  <path d={smooth(r)} className="cx-line" style={{ stroke: s.color }} />
                </g>
              ))}
              {dots && points.map((p, i) => <circle key={i} cx={cx(i)} cy={y(p.values[s.key] || 0)} r={hover === i ? 5 : 3} className="cx-dot" style={{ fill: s.color }} />)}
            </g>
          ))}

          {showLine && (
            <g>
              {rateRuns.map((r, j) => <path key={j} d={smooth(r)} className="cx-line" style={{ stroke: line.color }} />)}
              {(dots || hover !== null) && points.map((p, i) => p.rate == null ? null : (dots || hover === i) && <circle key={i} cx={cx(i)} cy={yr(p.rate)} r={hover === i ? 5 : 3} className="cx-dot" style={{ fill: line.color }} />)}
            </g>
          )}

          {hover !== null && <line x1={cx(hover)} x2={cx(hover)} y1={T} y2={H - B} className="cx-cross" />}

          {points.map((p, i) => (
            <g key={`h${i}`}>
              {i % every === 0 && <text x={cx(i)} y={H - 8} textAnchor="middle" className="ax">{p.label}</text>}
              <rect x={L + step * i} y={T} width={step} height={H - T - B} fill="transparent" tabIndex={0} aria-label={p.tip}
                onPointerEnter={() => setHover(i)} onPointerMove={() => setHover(i)} onPointerDown={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
            </g>
          ))}
        </svg>

        {hp && (
          <div className="cx-tip" data-side={cx(hover) > W * 0.58 ? 'l' : 'r'} style={{ left: `${(cx(hover) / W) * 100}%` }} role="status">
            <h4>{hp.tip}</h4>
            {active.map((s) => <div key={s.key}><i style={{ background: s.color }} />{s.label}<b>{n(hp.values[s.key])}</b></div>)}
            {active.length > 1 && <div className="tot">Total<b>{n(total(hp))}</b></div>}
            {showLine && <div><i className="ln" style={{ background: line.color }} />{line.label}<b>{hp.rate == null ? '–' : `${(hp.rate * 100).toFixed(1)}%`}</b></div>}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- sparkline (KPI cards) ----------
export function Sparkline({ values, color = 'var(--accent)', height = 38 }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const v = (values || []).filter((x) => x != null);
  if (v.length < 2) return <div className="spark" style={{ height }} />;
  const W = 140, H = height, P = 3;
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((x, i) => [P + ((W - 2 * P) * i) / (v.length - 1), H - P - ((H - 2 * P) * (x - lo)) / span]);
  const d = smooth(pts), last = pts[pts.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height }} aria-hidden="true">
      <defs><linearGradient id={uid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: color }} stopOpacity=".3" /><stop offset="1" style={{ stopColor: color }} stopOpacity="0" /></linearGradient></defs>
      <path d={`${d} L${f1(last[0])},${H} L${f1(pts[0][0])},${H} Z`} fill={`url(#${uid})`} />
      <path d={d} fill="none" style={{ stroke: color }} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ---------- ring gauge: one percentage ----------
export function Ring({ value, label, color = 'var(--ok)', size = 132 }) {
  const R = 52, C = 2 * Math.PI * R;
  const v = value == null ? 0 : Math.max(0, Math.min(1, value));
  return (
    <div className="ring" style={{ width: size }}>
      <svg viewBox="0 0 130 130" role="img" aria-label={`${label}: ${value == null ? 'no data' : `${(v * 100).toFixed(1)}%`}`}>
        <circle cx="65" cy="65" r={R} className="ring-bg" />
        <circle cx="65" cy="65" r={R} className="ring-fg" style={{ stroke: color }} strokeDasharray={`${C * v} ${C}`} transform="rotate(-90 65 65)" />
        <text x="65" y="64" textAnchor="middle" className="ring-val">{value == null ? '–' : `${(v * 100).toFixed(v === 1 || v === 0 ? 0 : 1)}%`}</text>
        <text x="65" y="83" textAnchor="middle" className="ax">{label}</text>
      </svg>
    </div>
  );
}

// ---------- ranked horizontal bars ----------
// items: [{ label, value, valueText?, sub?, color? }]
export function HBars({ items, onPick, activeLabel, max = 10, colorFor, empty = 'No data.' }) {
  if (!items.length) return <p className="muted">{empty}</p>;
  const shown = items.slice(0, max);
  const top = Math.max(...shown.map((i) => i.value), 1);
  return (
    <ul className="hb">
      {shown.map((i, idx) => (
        <li key={i.label} className={activeLabel === i.label ? 'on' : ''}>
          <span className="hb-rank">{idx + 1}</span>
          <span className="hb-body">
            <span className="hb-top">
              <span className="hb-label" title={i.label}>{onPick ? <button type="button" className="link" onClick={() => onPick(i.label)}>{i.label}</button> : i.label}</span>
              <span className="hb-val"><strong>{i.valueText ?? n(i.value)}</strong>{i.sub && <small className="muted">{i.sub}</small>}</span>
            </span>
            <span className="hb-track"><span className="hb-fill" style={{ width: `${Math.max((i.value / top) * 100, 1.5)}%`, background: i.color || colorFor?.(i, idx) || 'var(--grad)' }} /></span>
          </span>
        </li>
      ))}
      {items.length > max && <li className="muted hb-more">+ {items.length - max} more in the table below</li>}
    </ul>
  );
}

// ---------- donut / pie ----------
// slices: [{ label, value, color }]   pie = true fills the middle
export function Donut({ slices, pie = false, centerLabel, centerValue }) {
  const [hover, setHover] = useState(null);
  const data = slices.filter((s) => s.value > 0);
  const total = data.reduce((a, s) => a + s.value, 0);
  if (!total) return <p className="muted">No data.</p>;
  const R = 90, r = pie ? 0 : 62, C = 100;
  let a0 = -Math.PI / 2;
  const arcs = data.map((s) => {
    const frac = s.value / total;
    const a1 = a0 + frac * Math.PI * 2 - (data.length > 1 ? 0.02 : 0); // hairline gap between slices
    const pt = (rad, a) => [C + rad * Math.cos(a), C + rad * Math.sin(a)];
    let d;
    if (frac > 0.9999) {
      d = pie ? `M${C - R},${C} a${R},${R} 0 1,0 ${2 * R},0 a${R},${R} 0 1,0 ${-2 * R},0`
        : `M${C - R},${C} a${R},${R} 0 1,0 ${2 * R},0 a${R},${R} 0 1,0 ${-2 * R},0 M${C - r},${C} a${r},${r} 0 1,1 ${2 * r},0 a${r},${r} 0 1,1 ${-2 * r},0`;
    } else {
      const [x0, y0] = pt(R, a0), [x1, y1] = pt(R, a1), [x2, y2] = pt(r, a1), [x3, y3] = pt(r, a0);
      const big = a1 - a0 > Math.PI ? 1 : 0;
      d = `M${x0},${y0} A${R},${R} 0 ${big} 1 ${x1},${y1} ${r ? `L${x2},${y2} A${r},${r} 0 ${big} 0 ${x3},${y3}` : `L${C},${C}`} Z`;
    }
    const out = { ...s, d, frac };
    a0 += frac * Math.PI * 2;
    return out;
  });
  const h = hover !== null ? arcs[hover] : null;
  const pctText = (f) => `${(f * 100).toFixed(f < 0.1 ? 1 : 0)}%`;
  return (
    <div className="dn">
      <svg viewBox="0 0 200 200" role="img" aria-label={`Split: ${data.map((s) => `${s.label} ${n(s.value)}`).join(', ')}`} onMouseLeave={() => setHover(null)}>
        {arcs.map((s, i) => (
          <path key={s.label} d={s.d} fillRule="evenodd" fill={s.color} opacity={hover === null || hover === i ? 1 : 0.4}
            tabIndex={0} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} aria-label={`${s.label} ${n(s.value)}`} />
        ))}
        {!pie && (
          <>
            <text x="100" y="99" textAnchor="middle" className="dn-val">{h ? n(h.value) : centerValue ?? n(total)}</text>
            <text x="100" y="119" textAnchor="middle" className="ax">{h ? `${h.label} · ${pctText(h.frac)}` : centerLabel || 'total'}</text>
          </>
        )}
      </svg>
      <ul className="dn-leg">
        {arcs.map((s, i) => (
          <li key={s.label} className={hover === i ? 'on' : ''} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <i style={{ background: s.color }} /><span>{s.label}</span><strong>{n(s.value)}</strong><small className="muted">{pctText(s.frac)}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- small segmented switch ----------
export function Seg({ value, onChange, options, label, pill = false }) {
  return (
    <div className={`seg${pill ? ' pill' : ''}`} role="group" aria-label={label}>
      {options.map(([k, l]) => <button key={k} type="button" className={value === k ? 'on' : ''} aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  );
}