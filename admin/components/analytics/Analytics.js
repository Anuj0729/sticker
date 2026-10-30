'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { TimeChart, Sparkline, Ring, HBars, Donut, Seg } from '@/components/charts/Charts';

import { API } from '@/lib/api';

const PRESETS = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['all', 'All time'], ['custom', 'Custom']];
const TYPES = [['all', 'Stickers + GIFs'], ['sticker', 'Stickers only'], ['gif', 'GIFs only']];
const PLATFORMS = ['android', 'ios', 'web', 'server', 'other'];
const PLATFORM_LABEL = { android: 'Android', ios: 'iOS', web: 'Web', server: 'Server / tool', other: 'Other' };

const PLAT_COLOR = { android: 'var(--p-android)', ios: 'var(--p-ios)', web: 'var(--p-web)', server: 'var(--p-server)', other: 'var(--p-other)' };
const STATUS_COLOR = { success: 'var(--ok)', 'client error': 'var(--c-gif)', 'blocked (key)': 'var(--danger)', 'rate-limited': 'var(--p-other)', 'server error': '#a3162f' };
const TYPE_LABEL = { sticker: 'Stickers', gif: 'GIFs', all: 'Both (unified)' };
const TYPE_COLOR = { sticker: 'var(--c-sticker)', gif: 'var(--c-gif)', all: 'var(--c-unified)' };
const SERIES = [
  { key: 'sticker', label: 'Stickers', color: 'var(--c-sticker)' },
  { key: 'gif', label: 'GIFs', color: 'var(--c-gif)' },
  { key: 'unified', label: 'Unified', color: 'var(--c-unified)' },
];
const OUTCOME = [
  { key: 'success', label: 'Success', color: 'var(--ok)' },
  { key: 'failed', label: 'Failed', color: 'var(--danger)' },
];
const RATE_LINE = { label: 'Success rate', color: 'var(--accent)' };

const n = (v) => Number(v || 0).toLocaleString();
const rate = (v) => (v == null ? '–' : `${(v * 100).toFixed(1)}%`);
const pct = (v) => `${(v * 100).toFixed(v > 0 && v < 0.1 ? 1 : 0)}%`;
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, k) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + k);
const sqlUtc = (d) => d.toISOString().replace('T', ' ').slice(0, 19); // what the server stores/compares
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayLabel = (s) => new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const dayLong = (s) => new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

// "Last 7 days" etc. -> { from, to } in UTC text, computed from the admin's local midnight
function rangeFor(preset, cFrom, cTo) {
  const today = midnight(new Date());
  if (preset === 'today') return { from: sqlUtc(today) };
  if (preset === '7d') return { from: sqlUtc(addDays(today, -6)) };
  if (preset === '30d') return { from: sqlUtc(addDays(today, -29)) };
  if (preset === '90d') return { from: sqlUtc(addDays(today, -89)) };
  if (preset === 'custom') {
    const out = {};
    if (cFrom) out.from = sqlUtc(new Date(`${cFrom}T00:00:00`));
    if (cTo) out.to = sqlUtc(addDays(new Date(`${cTo}T00:00:00`), 1)); // end date is included
    return out;
  }
  return {};
}

// ---------- small building blocks ----------
const ICONS = {
  hits: 'M3 12h4l3-8 4 16 3-8h4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  clock: 'M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z',
  source: 'M4 6h16M4 12h16M4 18h10',
  device: 'M8 3h8a1 1 0 011 1v16a1 1 0 01-1 1H8a1 1 0 01-1-1V4a1 1 0 011-1zM11 18h2',
  users: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20c0-3 2.7-5 6-5s6 2 6 5M16 11a3 3 0 100-6M18 15c2 .4 3.5 2 3.5 5',
};
const Icon = ({ name }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name]} /></svg>
);

function Section({ title, sub, children }) {
  return (
    <section className="an-sec">
      <div className="an-sec-h"><h2>{title}</h2>{sub && <p className="muted">{sub}</p>}</div>
      {children}
    </section>
  );
}

function CardHead({ title, sub, right }) {
  return (
    <div className="an-ch">
      <div><h3>{title}</h3>{sub && <p className="muted">{sub}</p>}</div>
      {right}
    </div>
  );
}

function Kpi({ label, value, sub, icon, tone, small, spark, sparkColor }) {
  return (
    <div className="kpi an-kpi" style={tone ? { '--tone': tone } : undefined}>
      <div className="an-kpi-top"><span className="an-ico"><Icon name={icon} /></span><span className="muted">{label}</span></div>
      <strong className={small ? 'kv small' : 'kv'} title={String(value)}>{value}</strong>
      <small className="muted">{sub}</small>
      {spark && <Sparkline values={spark} color={sparkColor || tone || 'var(--accent)'} />}
    </div>
  );
}

function Stat({ label, value, tone }) {
  return <div className="an-stat" style={tone ? { '--tone': tone } : undefined}><span className="muted">{label}</span><strong>{value}</strong></div>;
}

function Toggle({ checked, onChange, children }) {
  return (
    <label className="an-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span>{children}</span>
    </label>
  );
}

// ---------- the page ----------
export default function Analytics({ call, token, onLogout }) {
  const [preset, setPreset] = useState('7d');
  const [cFrom, setCFrom] = useState(ymd(addDays(new Date(), -6)));
  const [cTo, setCTo] = useState(ymd(new Date()));
  const [type, setType] = useState('all');
  const [platform, setPlatform] = useState('');
  const [source, setSource] = useState('');
  const [hideTester, setHideTester] = useState(false); // off by default: otherwise your own tester hits look like "no data"
  const [auto, setAuto] = useState(true);
  const [chartKind, setChartKind] = useState('bar');

  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState('');
  const [updated, setUpdated] = useState(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ tz: String(-new Date().getTimezoneOffset()) });
    const r = rangeFor(preset, cFrom, cTo);
    if (r.from) p.set('from', r.from);
    if (r.to) p.set('to', r.to);
    if (type !== 'all') p.set('type', type);
    if (platform) p.set('platform', platform);
    if (source) p.set('source', source);
    if (hideTester) p.set('hideTester', '1');
    return p.toString();
  }, [preset, cFrom, cTo, type, platform, source, hideTester]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await call(`/admin/analytics?${qs}`, { token })); setErr(''); setUpdated(new Date()); }
    catch (e) { e.status === 401 ? onLogout() : setErr(e.message); }
    finally { setLoading(false); }
  }, [call, token, qs, onLogout]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30000);
    return () => clearInterval(t);
  }, [auto, load]);

  // The file is fetched with the admin token, then saved from memory
  const download = async (format) => {
    setExporting(format); setErr('');
    try {
      const res = await fetch(`${API}/admin/analytics/export?${qs}&format=${format}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) return onLogout();
      if (!res.ok) throw new Error('Export failed');
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || `api-analytics.${format}`;
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { setErr(e.message); }
    finally { setExporting(''); }
  };

  const t = data?.totals;
  const topPlatform = data?.platforms?.[0];
  const hitsSpark = data?.timeline.points.map((p) => p.hits);
  const rateSpark = data?.daily.map((d) => d.successRate);

  return (
    <>
      {/* ---------- filter bar ---------- */}
      <div className="card an-bar">
        <div className="an-row">
          <Seg pill label="Period" value={preset} onChange={setPreset} options={PRESETS} />
          {preset === 'custom' && (
            <div className="an-dates">
              <input aria-label="From" type="date" value={cFrom} max={cTo || undefined} onChange={(e) => setCFrom(e.target.value)} />
              <span className="muted">to</span>
              <input aria-label="To" type="date" value={cTo} min={cFrom || undefined} onChange={(e) => setCTo(e.target.value)} />
            </div>
          )}
          <span className="an-spacer" />
          <div className="an-actions">
            <button className="btn" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
            <button className="btn pri" onClick={() => download('xlsx')} disabled={!!exporting} title="Summary, daily success/failed, search demand, most used, sources, platforms, endpoints, timeline and every hit">
              {exporting === 'xlsx' ? 'Preparing…' : 'Export Excel'}
            </button>
            <button className="btn" onClick={() => download('csv')} disabled={!!exporting} title="Every hit as CSV">{exporting === 'csv' ? 'Preparing…' : 'CSV'}</button>
          </div>
        </div>
        <div className="an-row">
          <label className="an-sel"><span>API</span>
            <select className="sel" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <label className="an-sel"><span>Platform</span>
            <select className="sel" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="">All platforms</option>
              {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
            </select>
          </label>
          <Toggle checked={hideTester} onChange={setHideTester}>Hide API tester</Toggle>
          <Toggle checked={auto} onChange={setAuto}>Auto-refresh</Toggle>
          {source && <button className="chip on" onClick={() => setSource('')} title="Remove source filter">Source: {source} ×</button>}
          <span className="an-spacer" />
          {updated && <span className="muted an-upd"><i className={`live${auto ? ' on' : ''}`} />Updated {updated.toLocaleTimeString()}</span>}
        </div>
        {err && <p className="err">{err}</p>}
      </div>

      {!data && !err && <p className="muted">Loading analytics…</p>}

      {data && t.hits === 0 && (
        <div className="card">
          <h2>No API hits in this period</h2>
          <p className="muted">Nothing has called the public API for these filters yet. Widen the period, or see “How to label your calls” below.</p>
          {hideTester && <p className="muted"><strong>“Hide API tester” is ON</strong>, so calls made from the /tester page are not shown. <button type="button" className="btn" onClick={() => setHideTester(false)}>Show tester traffic</button></p>}
        </div>
      )}

      {data && (
        <>
          {/* ---------- overview ---------- */}
          <Section title="Overview" sub="Totals for the selected period">
            <div className="an-kpis">
              <Kpi icon="hits" label="Total API hits" value={n(t.hits)} sub={`${n(t.clients)} unique clients`} spark={hitsSpark} sparkColor="var(--accent)" />
              <Kpi icon="check" label="Success rate" value={rate(t.successRate)} tone="var(--ok)"
                sub={`${n(t.hits - t.errors)} success · ${n(t.errors)} failed`} spark={rateSpark} sparkColor="var(--ok)" />
              <Kpi icon="clock" label="Avg response time" value={`${n(t.avgMs)} ms`} tone="var(--c-gif)" sub="Across all endpoints" />
              <Kpi icon="source" label="Most used source" value={data.topSource?.source || '–'} small tone="var(--c-sticker)"
                sub={data.topSource ? `${n(data.topSource.hits)} hits · ${pct(data.topSource.share)} of all` : 'no data'} />
              <Kpi icon="device" label="Top platform" value={topPlatform ? PLATFORM_LABEL[topPlatform.platform] : '–'} small tone="var(--p-ios)"
                sub={topPlatform ? `${n(topPlatform.hits)} hits · ${pct(topPlatform.hits / t.hits)}` : 'no data'} />
              <Kpi icon="users" label="Active sources" value={n(t.sources)} tone="var(--c-unified)" sub="Apps / sites that called the API" />
            </div>

            <div className="card">
              <CardHead title="Hits over time" sub={`Per ${data.timeline.bucket} · click a legend item to hide it`}
                right={<Seg label="Chart type" value={chartKind} onChange={setChartKind} options={[['bar', 'Bar'], ['line', 'Line'], ['area', 'Area']]} />} />
              <TimeChart kind={chartKind} series={SERIES} ariaLabel="API hits over time"
                points={data.timeline.points.map((p) => ({
                  label: data.timeline.bucket === 'hour' ? p.t.slice(11, 16) : dayLabel(p.t.slice(0, 10)),
                  tip: data.timeline.bucket === 'hour' ? p.t : dayLong(p.t.slice(0, 10)),
                  values: { sticker: p.sticker, gif: p.gif, unified: p.unified },
                }))} />
            </div>
          </Section>

          {/* ---------- traffic ---------- */}
          <Section title="Traffic" sub="Who calls the API, from where and when">
            <div className="grid2">
              <div className="card">
                <CardHead title="Top sources" sub="Click a name to filter the whole dashboard" />
                <HBars items={data.sources.map((s) => ({ label: s.source, value: s.hits, sub: pct(s.share) }))} onPick={(l) => setSource(source === l ? '' : l)} activeLabel={source} />
              </div>
              <div className="card">
                <CardHead title="Platform split" />
                <Donut centerLabel="hits" slices={data.platforms.map((p) => ({ label: PLATFORM_LABEL[p.platform] || p.platform, value: p.hits, color: PLAT_COLOR[p.platform] || 'var(--p-other)' }))} />
              </div>
              <div className="card">
                <CardHead title="Stickers vs GIFs" sub="Which API was called" />
                <Donut pie slices={data.types.map((x) => ({ label: TYPE_LABEL[x.type] || x.type, value: x.hits, color: TYPE_COLOR[x.type] || 'var(--p-other)' }))} />
              </div>
              <div className="card">
                <CardHead title="Busiest hours of the day" sub="Your local time · the peak hour is highlighted" />
                <TimeChart kind="bar" highlightMax legend={false} height={250} labelEvery={3} ariaLabel="Hits by hour of the day"
                  series={[{ key: 'hits', label: 'Hits', color: 'var(--accent)' }]}
                  points={(data.byHour || []).map((h) => ({ label: String(h.hour).padStart(2, '0'), tip: `${String(h.hour).padStart(2, '0')}:00 – ${String(h.hour).padStart(2, '0')}:59`, values: { hits: h.hits } }))} />
              </div>
            </div>

            <div className="card">
              <CardHead title="Where the API is called from" sub="Ranked by number of hits · click a source to filter" />
              {data.sources.length === 0 ? <p className="muted">No data.</p> : (
                <div className="tscroll">
                  <table className="atbl">
                    <thead><tr><th>#</th><th>Source</th><th className="num">Hits</th><th style={{ minWidth: 130 }}>Share</th><th className="num">Stickers</th><th className="num">GIFs</th><th className="num">Both</th><th>Platforms</th><th>Last hit</th></tr></thead>
                    <tbody>
                      {data.sources.map((s) => (
                        <tr key={s.source} className={source === s.source ? 'sel-row' : ''}>
                          <td className="muted">{s.rank}</td>
                          <td><button className="link" onClick={() => setSource(source === s.source ? '' : s.source)} title="Filter by this source">{s.source}</button></td>
                          <td className="num"><strong>{n(s.hits)}</strong></td>
                          <td><div className="bar"><span style={{ width: `${Math.max(s.share * 100, 1.5)}%` }} /></div><small className="muted">{pct(s.share)}</small></td>
                          <td className="num">{n(s.sticker)}</td><td className="num">{n(s.gif)}</td><td className="num">{n(s.unified)}</td>
                          <td>{PLATFORMS.filter((p) => s.platforms[p]).map((p) => <span key={p} className={`pl pl-${p}`}>{PLATFORM_LABEL[p]} {n(s.platforms[p])}</span>)}</td>
                          <td className="muted nowrap">{s.last_hit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="card">
              <CardHead title="Source × platform" sub="Darker cell = bigger share of that source's hits" />
              {data.sources.length > 0 && (
                <div className="tscroll">
                  <table className="atbl">
                    <thead><tr><th>Source</th>{PLATFORMS.map((p) => <th key={p} className="num">{PLATFORM_LABEL[p]}</th>)}<th className="num">Total</th></tr></thead>
                    <tbody>
                      {data.sources.map((s) => (
                        <tr key={s.source}>
                          <td>{s.source}</td>
                          {PLATFORMS.map((p) => {
                            const v = s.platforms[p] || 0;
                            return <td key={p} className="num heat" style={v ? { '--h': Math.min(v / s.hits, 1) } : undefined}>{v ? n(v) : <span className="muted">–</span>}</td>;
                          })}
                          <td className="num"><strong>{n(s.hits)}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="card">
              <CardHead title="Endpoints" />
              <div className="tscroll">
                <table className="atbl">
                  <thead><tr><th>Endpoint</th><th className="num">Hits</th><th className="num">Errors</th><th className="num">Avg ms</th></tr></thead>
                  <tbody>
                    {data.endpoints.map((e) => (
                      <tr key={e.endpoint}><td><code>{e.endpoint}</code></td><td className="num">{n(e.hits)}</td><td className="num">{e.errors ? <span style={{ color: 'var(--danger)' }}>{n(e.errors)}</span> : '–'}</td><td className="num">{e.avg_ms}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <CardHead title="Latest hits" sub={`Newest ${data.recent.length}`} />
              <div className="tscroll tall">
                <table className="atbl">
                  <thead><tr><th>Time</th><th>Source</th><th>Platform</th><th>Endpoint</th><th>Filters</th><th className="num">Status</th><th className="num">Results</th><th className="num">ms</th></tr></thead>
                  <tbody>
                    {data.recent.map((r, i) => (
                      <tr key={i}>
                        <td className="nowrap muted">{r.time}</td><td>{r.source}</td>
                        <td><span className={`pl pl-${r.platform}`}>{PLATFORM_LABEL[r.platform] || r.platform}</span></td>
                        <td><code>{r.method} {r.endpoint}</code> <small className="muted">{r.type}</small></td>
                        <td className="muted">{r.params || '–'}</td>
                        <td className="num"><span className={`st-pill ${r.status >= 400 ? 'bad' : 'ok'}`}>{r.status}</span></td>
                        <td className="num">{r.result_count ?? '–'}</td><td className="num">{r.ms}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Section>

          {/* ---------- reliability ---------- */}
          <Section title="Reliability" sub="Did the API answer successfully? Success = HTTP below 400">
            <DailyOutcome daily={data.daily} totals={t} />
            <div className="grid2">
              <div className="card">
                <CardHead title="Response outcome" sub="Why calls did not succeed" />
                <Donut centerLabel="calls" slices={(data.statuses || []).map((x) => ({ label: x.grp, value: x.hits, color: STATUS_COLOR[x.grp] || 'var(--p-other)' }))} />
              </div>
              <div className="card">
                <CardHead title="Slowest endpoints" sub="Average response time" />
                <HBars items={[...data.endpoints].sort((a, b) => b.avg_ms - a.avg_ms).map((e) => ({ label: e.endpoint, value: e.avg_ms, valueText: `${e.avg_ms} ms`, sub: `${n(e.hits)} hits` }))}
                  colorFor={() => 'var(--c-gif)'} />
              </div>
            </div>
          </Section>

          {/* ---------- search demand ---------- */}
          <SearchDemand sd={data.searchDemand} />

          {/* ---------- most used ---------- */}
          <MostUsed mu={data.mostUsed} />

        </>
      )}

      <details className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>How to label your calls (so “source” and “platform” are accurate)</summary>
        <p className="muted">Every app or website that calls the API should say who it is. Add two headers (or the same names as query parameters):</p>
        <pre>{`GET ${API}/api/media?type=gif&tag=happy
X-Source: chat-keyboard        # app / screen / website name
X-Platform: android            # android | ios | web`}</pre>
        <p className="muted">
          Without them, the source falls back to the API key name, then the website the call came from (Origin/Referer) or “unknown”, and the platform is guessed from the User-Agent
          (okhttp → Android, CFNetwork → iOS, browsers → Web, curl/Postman/Node → Server / tool).
          IP addresses are never stored, only a short one-way hash to count unique clients.
        </p>
        <p className="muted">
          <strong>Most used</strong> is counted when your chat backend reports a use: <code>POST /api/media/:id/use</code> (after a sticker / GIF was actually sent).
          <strong> Search demand</strong> is counted automatically from the <code>tag</code> and <code>pack</code> filters of every successful search (page 1 only).
        </p>
      </details>
    </>
  );
}

// ---------- (a) success vs failed, per day ----------
function DailyOutcome({ daily, totals }) {
  const days = daily || [];
  const sum = (k) => days.reduce((a, d) => a + d[k], 0);
  const hits = sum('hits'), ok = sum('success'), failed = hits - ok;
  const busy = days.filter((d) => d.hits);
  const peak = busy.reduce((b, d) => (!b || d.hits > b.hits ? d : b), null);
  const worst = busy.filter((d) => d.failed).reduce((b, d) => (!b || d.successRate < b.successRate ? d : b), null);
  const why = (d) => [d.blocked && `${n(d.blocked)} blocked (key)`, d.limited && `${n(d.limited)} rate-limited`, d.errors && `${n(d.errors)} other errors`].filter(Boolean).join(' · ');
  return (
    <div className="card">
      <CardHead title="Success vs failed per day" sub="Bars: calls per day · line: success rate (right axis)" />
      <div className="an-rel">
        <div className="an-rel-side">
          <Ring value={hits ? ok / hits : null} label="success rate" />
          <ul className="an-legend-list">
            <li><span>Total</span><strong>{n(hits)}</strong></li>
            <li><span><i style={{ background: 'var(--ok)' }} />Success</span><strong>{n(ok)}</strong></li>
            <li><span><i style={{ background: 'var(--danger)' }} />Failed</span><strong>{n(failed)}</strong></li>
          </ul>
        </div>
        <div className="an-rel-chart">
          <TimeChart kind="bar" series={OUTCOME} line={RATE_LINE} ariaLabel="Successful and failed API hits per day, with success rate"
            points={days.map((d) => ({ label: dayLabel(d.day), tip: dayLong(d.day), values: { success: d.success, failed: d.failed }, rate: d.successRate }))} />
        </div>
      </div>

      {busy.length > 0 && (
        <div className="an-stats">
          <Stat label="Average per day" value={n(Math.round(hits / days.length))} />
          <Stat label="Busiest day" value={peak ? `${dayLabel(peak.day)} · ${n(peak.hits)}` : '–'} tone="var(--accent)" />
          <Stat label="Lowest success rate" value={worst ? `${dayLabel(worst.day)} · ${rate(worst.successRate)}` : 'No failures'} tone={worst ? 'var(--danger)' : 'var(--ok)'} />
        </div>
      )}

      {days.length > 0 && (
        <details className="an-details" open>
          <summary>Daily breakdown ({days.length} {days.length === 1 ? 'day' : 'days'})</summary>
          <div className="tscroll tall">
            <table className="atbl">
              <thead><tr><th>Day</th><th className="num">Hits</th><th className="num">Success</th><th className="num">Failed</th><th style={{ minWidth: 170 }}>Success rate</th><th>Why they failed</th></tr></thead>
              <tbody>
                {[...days].reverse().map((d) => (
                  <tr key={d.day}>
                    <td className="nowrap">{dayLong(d.day)}</td>
                    <td className="num">{n(d.hits)}</td>
                    <td className="num">{n(d.success)}</td>
                    <td className="num" style={d.failed ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{d.failed ? n(d.failed) : '–'}</td>
                    <td>
                      {d.hits ? (
                        <div className="rate">
                          <div className="bar"><span style={{ width: `${d.successRate * 100}%`, background: d.successRate < 0.9 ? 'var(--danger)' : d.successRate < 0.98 ? 'var(--p-other)' : 'var(--ok)' }} /></div>
                          <strong>{rate(d.successRate)}</strong>
                        </div>
                      ) : <span className="muted">no hits</span>}
                    </td>
                    <td className="muted">{why(d) || '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

// ---------- (b) what people search for ----------
function SearchDemand({ sd }) {
  const tags = sd?.tags || [], packs = sd?.packs || [];
  const t = sd?.totals || {};
  const [show, setShow] = useState('tag');
  const rows = show === 'tag' ? tags : packs;
  const sub = (x) => (x.no_result ? `${pct(x.share)} · ${n(x.no_result)} empty` : pct(x.share));
  return (
    <Section title="Search demand" sub="What people look for. “Empty” = searched, but you have nothing for it — your next uploads">
      <div className="an-stats three">
        <Stat label="Tag searches" value={n(t.tagSearches)} tone="var(--accent)" />
        <Stat label="Pack searches" value={n(t.packSearches)} tone="var(--c-gif)" />
        <Stat label="Searches with no result" value={n(t.noResult)} tone={t.noResult ? 'var(--danger)' : 'var(--ok)'} />
      </div>
      <div className="grid2">
        <div className="card">
          <CardHead title="Most searched tags" />
          <HBars items={tags.map((x) => ({ label: x.term, value: x.searches, sub: sub(x) }))} colorFor={(_, i) => (tags[i].no_result === tags[i].searches ? 'var(--danger)' : 'var(--grad)')} empty="No tag searches yet." />
        </div>
        <div className="card">
          <CardHead title="Most searched packs" />
          <HBars items={packs.map((x) => ({ label: x.term, value: x.searches, sub: sub(x) }))} colorFor={(_, i) => (packs[i].no_result === packs[i].searches ? 'var(--danger)' : 'var(--c-gif)')} empty="No pack searches yet." />
        </div>
      </div>
      <div className="card">
        <CardHead title="Search demand details" sub="Sticker / GIF columns show which API the search was made on"
          right={<Seg label="Searched for" value={show} onChange={setShow} options={[['tag', 'Tags'], ['pack', 'Packs']]} />} />
        {rows.length === 0 ? <p className="muted">No searches yet for these filters. Searches are counted when a call uses <code>?tag=</code> or <code>?pack=</code>.</p> : (
          <div className="tscroll tall">
            <table className="atbl">
              <thead><tr><th>#</th><th>{show === 'tag' ? 'Tag' : 'Pack'}</th><th className="num">Searches</th><th style={{ minWidth: 110 }}>Share</th><th className="num">Sticker API</th><th className="num">GIF API</th><th className="num">Both</th><th className="num">No result</th><th className="num">Avg found</th><th>Last searched</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.term}>
                    <td className="muted">{r.rank}</td>
                    <td><strong>{r.term}</strong></td>
                    <td className="num"><strong>{n(r.searches)}</strong></td>
                    <td><div className="bar"><span style={{ width: `${Math.max(r.share * 100, 1.5)}%` }} /></div><small className="muted">{pct(r.share)}</small></td>
                    <td className="num">{n(r.sticker)}</td><td className="num">{n(r.gif)}</td><td className="num">{n(r.unified)}</td>
                    <td className="num">{r.no_result ? <span className="st-pill bad">{n(r.no_result)}</span> : '–'}</td>
                    <td className="num">{n(r.avg_results)}</td>
                    <td className="muted nowrap">{r.last_search}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Section>
  );
}

// ---------- (c) which sticker / GIF is used the most ----------
function MostUsed({ mu }) {
  if (!mu) return null;
  const col = (title, d, noun) => {
    const [first, ...rest] = d.items;
    return (
      <div className="card">
        <CardHead title={title} sub={`${n(d.total)} uses in total`} />
        {!first ? (
          <p className="muted">No {noun} usage {mu.basis === 'log' ? 'in this period' : 'reported yet'}.</p>
        ) : (
          <>
            <div className="mu-hero">
              <div className="mu-img"><span className="mu-crown">#1</span><img src={first.url} alt={first.tags.join(' ') || noun} /></div>
              <div className="mu-info">
                <span className="muted">Most used {noun}</span>
                <strong className="mu-big">{n(first.uses)} <small>uses</small></strong>
                <div className="mu-share"><span className="bar"><span style={{ width: `${Math.max(first.share * 100, 2)}%` }} /></span><small className="muted">{pct(first.share)} of all {noun} uses</small></div>
                <div className="mu-tags">{first.tags.slice(0, 4).map((x) => <span key={x} className="tagpill">{x}</span>)}<span className="muted">{first.pack} · ID {first.id}</span></div>
              </div>
            </div>
            {rest.length > 0 && (
              <ul className="mu-list">
                {rest.map((i) => (
                  <li key={i.id} title={i.lastUsed ? `Last used ${i.lastUsed}` : undefined}>
                    <span className="hb-rank">{i.rank}</span>
                    <span className="mu-th"><img src={i.url} alt="" loading="lazy" /></span>
                    <span className="mu-main">
                      <span className="mu-name">{i.tags.join(', ') || `${noun} ${i.id}`}</span>
                      <span className="hb-track"><span className="hb-fill" style={{ width: `${Math.max((i.uses / first.uses) * 100, 2)}%`, background: 'var(--grad)' }} /></span>
                      <small className="muted">{i.pack} · ID {i.id}</small>
                    </span>
                    <span className="mu-n"><strong>{n(i.uses)}</strong><small className="muted">{pct(i.share)}</small></span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    );
  };
  return (
    <Section title="Most used" sub={mu.basis === 'counter'
      ? 'All-time totals. Pick a period, source or platform above to see just that selection.'
      : 'Uses inside the selected period / source / platform, counted from usage reports since this feature was added.'}>
      <div className="grid2">
        {col('Stickers', mu.sticker, 'sticker')}
        {col('GIFs', mu.gif, 'GIF')}
      </div>
      <p className="muted" style={{ margin: '-4px 4px 0' }}>A “use” is counted when your chat backend calls <code>POST /api/media/:id/use</code>.</p>
    </Section>
  );
}