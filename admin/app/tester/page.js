'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// Same tester for both APIs; only the endpoints differ
const KINDS = {
  sticker: { noun: 'sticker', label: 'Stickers', list: '/api/stickers', packs: '/api/packs', tags: '/api/tags', ex: 'Cats' },
  gif: { noun: 'GIF', label: 'GIFs', list: '/api/gifs', packs: '/api/gif-packs', tags: '/api/gifs/tags', ex: 'Reactions' },
};

export default function Tester() {
  const [kind, setKind] = useState('sticker');
  const cfg = KINDS[kind];
  const [pack, setPack] = useState('');
  const [tag, setTag] = useState('');
  const [related, setRelated] = useState(true);

  const [packs, setPacks] = useState([]);
  const [tags, setTags] = useState([]);
  const [res, setRes] = useState(null); // { status, ms, json } | { error }
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState('');

  const buildUrl = () => {
    const p = new URLSearchParams();
    if (pack.trim()) p.set('pack', pack.trim());
    if (tag.trim()) p.set('tag', tag.trim());
    if (!related) p.set('related', '0');
    return `${API}${cfg.list}?${p}`;
  };
  const url = buildUrl();

  const run = async () => {
    setLoading(true);
    const target = buildUrl();
    const t0 = performance.now();
    try {
      const r = await fetch(target, { cache: 'no-store' });
      const json = await r.json();
      setRes({ status: r.status, ms: Math.round(performance.now() - t0), json, url: target });
    } catch (e) {
      setRes({ error: `Could not reach ${API}. Is the server running?` });
    } finally { setLoading(false); }
  };

  // Keep pack/tag suggestions fresh: on load, when you come back to this tab,
  // every 15 s, and instantly when an admin tab changes something.
  const loadLists = useCallback(async () => {
    try {
      const [p, t] = await Promise.all([
        fetch(`${API}${cfg.packs}`, { cache: 'no-store' }).then((r) => r.json()),
        fetch(`${API}${cfg.tags}`, { cache: 'no-store' }).then((r) => r.json()),
      ]);
      setPacks(p); setTags(t);
    } catch {}
  }, [cfg]);

  const latest = useRef({});
  latest.current = { run, hasResult: !!res };

  useEffect(() => {
    loadLists();
    const refresh = () => { if (document.visibilityState === 'visible') loadLists(); };
    let ch;
    try {
      ch = new BroadcastChannel('sticker-studio');
      ch.onmessage = () => { loadLists(); const l = latest.current; if (l.hasResult) l.run(); };
    } catch {}
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const timer = setInterval(refresh, 15000);
    return () => {
      ch?.close();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      clearInterval(timer);
    };
  }, [loadLists]);

  const copy = async (what, text) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 1500); } catch {}
  };

  const json = res?.json;
  const noun = cfg.noun;

  // Switching API clears the filters and the old result
  const switchKind = (k) => {
    if (k === kind) return;
    setKind(k); setPack(''); setTag(''); setRes(null); setPacks([]); setTags([]);
  };

  return (
    <div className="wrap">
      <div className="top">
        <div>
          <h1>{cfg.label} API tester</h1>
          <span className="muted">Try the filters, see the results and the exact URL to use.</span>
        </div>
        <a className="btn" href="/">Back to admin</a>
      </div>

      <div className="tabs" role="tablist">
        {Object.entries(KINDS).map(([k, c]) => (
          <button key={k} role="tab" aria-selected={kind === k} className={`tab${kind === k ? ' on' : ''}`} onClick={() => switchKind(k)}>
            {c.label}
          </button>
        ))}
      </div>

      <form className="card" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <div className="row">
            <div className="field">
              <label htmlFor="pack">Pack name</label>
              <input id="pack" type="text" list="packs" placeholder={`e.g. ${cfg.ex}`} value={pack} onChange={(e) => { setPack(e.target.value); }} />
              <datalist id="packs">{packs.map((p) => <option key={p.id} value={p.name}>{p.count} {noun}s</option>)}</datalist>
            </div>
          <div className="field">
            <label htmlFor="tag">Tag</label>
            <input id="tag" type="text" list="tags" placeholder="e.g. happy" value={tag} onChange={(e) => { setTag(e.target.value); }} />
            <datalist id="tags">{tags.map((t) => <option key={t.tag} value={t.tag} />)}</datalist>
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={related} onChange={(e) => { setRelated(e.target.checked); }} /> Include related {noun}s
          </label>
          <button className="btn pri" disabled={loading}>{loading ? 'Loading…' : 'Run request'}</button>
          <span className="muted">{packs.length} packs · {tags.length} tags</span>
        </div>

        <div className="urlbox" style={{ marginTop: 14 }}>GET {url}</div>
          <button
            type="button"
            className="btn"
            style={{ marginTop: 8 }}
            onClick={() => copy('url', url)}
          >
            {copied === 'url' ? 'Copied ✓' : 'Copy URL'}
          </button>
      </form>

      {res?.error && <p className="err">{res.error}</p>}

      {json && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>
              {res.status !== 200 ? `Error ${res.status}`
                : json.total === 1 ? `1 ${noun}`
                : `${json.total} ${noun}s`}
              {res.status === 200 && json.matched !== json.total && <span className="muted"> · {json.matched} direct, {json.total - json.matched} related</span>}
            </h2>
            <span className="muted">HTTP {res.status} · {res.ms} ms</span>
          </div>

          {json.error && <p className="err">{json.error}</p>}
          {res.status === 200 && json.data.length === 0 && <p className="muted">Nothing matched. Try a different pack or tag, or clear a filter.</p>}

          {json.data?.length > 0 && (
            <div className="grid">
              {json.data.map((s) => (
                <div className="st" key={s.id}>
                  {s.match === 'tag' && <span className="badge">match</span>}
                  {s.match === 'related' && <span className="badge rel">related</span>}
                  <img src={s.url} alt={s.tags.join(' ') || noun} loading="lazy" />
                  <small>{s.pack.name}</small>
                  <small>{s.tags.join(', ') || 'no tags'}</small>
                </div>
              ))}
            </div>
          )}

          <details style={{ marginTop: 14 }}>
            <summary className="muted" style={{ cursor: 'pointer' }}>Raw JSON response</summary>
            <pre>{JSON.stringify(json, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  );
}
