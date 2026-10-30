'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { API } from '@/lib/api';

// Tabs: Stickers -> /api/stickers, GIFs -> /api/gifs, All -> /api/media?type=all
const KINDS = {
  all: { noun: 'item', label: 'All', ex: 'Cats' },
  sticker: { noun: 'sticker', label: 'Stickers', ex: 'Cats' },
  gif: { noun: 'GIF', label: 'GIFs', ex: 'Reactions' },
};
// Tells the analytics dashboard these calls come from the admin tester (it can hide them)
const baseHeaders = { 'X-Source': 'admin-tester', 'X-Platform': 'web' };

export default function ApiTester() {
  const [kind, setKind] = useState('all');
  const cfg = KINDS[kind];
  const [pack, setPack] = useState('');
  const [tag, setTag] = useState('');
  const [limit, setLimit] = useState('30');
  const [related, setRelated] = useState(true);
  const [offset, setOffset] = useState(0);

  const [packs, setPacks] = useState([]);
  const [tags, setTags] = useState([]);
  const [res, setRes] = useState(null); // { status, ms, json } | { error }
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState('');
  // The API needs a key from the admin (API keys tab). It is remembered in this browser only.
  const [apiKey, setApiKey] = useState('');
  useEffect(() => { try { setApiKey(localStorage.getItem('tester_api_key') || ''); } catch {} }, []);
  const saveKey = (v) => { setApiKey(v); try { localStorage.setItem('tester_api_key', v); } catch {} };
  const HEADERS = { ...baseHeaders, ...(apiKey.trim() && { 'X-API-Key': apiKey.trim() }) };
  const hdr = useRef(HEADERS);
  hdr.current = HEADERS;

  // Limit is always a whole number from 1 to 100 (blank/0 means the default, 30)
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);

  const buildUrl = (off) => {
    const p = new URLSearchParams();
    // Stickers tab -> /api/stickers, GIFs tab -> /api/gifs, All tab -> /api/media?type=all (search across both)
    if (kind === 'all') p.set('type', 'all');
    if (pack.trim()) p.set('pack', pack.trim());
    if (tag.trim()) p.set('tag', tag.trim());
    if (!related) p.set('related', '0');
    p.set('limit', String(limitNum));
    if (off) p.set('offset', String(off));
    const path = kind === 'sticker' ? '/api/stickers' : kind === 'gif' ? '/api/gifs' : '/api/media';
    return `${API}${path}?${p}`;
  };
  const url = buildUrl(offset);

  const run = async (nextOffset = 0) => {
    setOffset(nextOffset);
    setLoading(true);
    const target = buildUrl(nextOffset);
    const t0 = performance.now();
    try {
      const r = await fetch(target, { cache: 'no-store', headers: hdr.current });
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
        fetch(`${API}/api/media/packs?type=${kind}`, { cache: 'no-store', headers: hdr.current }).then((r) => r.json()),
        fetch(`${API}/api/media/tags?type=${kind}`, { cache: 'no-store', headers: hdr.current }).then((r) => r.json()),
      ]);
      setPacks(Array.isArray(p) ? p : []); setTags(Array.isArray(t) ? t : []);
    } catch {}
  }, [kind, apiKey]);

  const latest = useRef({});
  latest.current = { run, offset, hasResult: !!res };

  useEffect(() => {
    loadLists();
    const refresh = () => { if (document.visibilityState === 'visible') loadLists(); };
    let ch;
    try {
      ch = new BroadcastChannel('sticker-studio');
      ch.onmessage = () => { loadLists(); const l = latest.current; if (l.hasResult) l.run(l.offset); };
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
    setKind(k); setPack(''); setTag(''); setOffset(0); setRes(null); setPacks([]); setTags([]);
  };

  return (
    <div className="wrap">
      <div className="top">
        <div>
          <h1>GaonGram Studio</h1>
          <span className="muted">One API for both: pick Stickers, GIFs or All, try the filters and copy the exact URL.</span>
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

      <form className="card" onSubmit={(e) => { e.preventDefault(); run(0); }}>
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="field">
            <label htmlFor="apikey">API key (needed only when “Require API key” is ON in Admin → API keys)</label>
            <input id="apikey" type="password" autoComplete="off" placeholder="stk_..." value={apiKey} onChange={(e) => saveKey(e.target.value)} />
          </div>
        </div>
        <div className="row">
            <div className="field">
              <label htmlFor="pack">Pack name</label>
              <input id="pack" type="text" list="packs" placeholder={`e.g. ${cfg.ex}`} value={pack} onChange={(e) => { setPack(e.target.value); setOffset(0); }} />
              <datalist id="packs">{packs.map((p) => <option key={p.id} value={p.name}>{p.count} {noun}s</option>)}</datalist>
            </div>
          <div className="field">
            <label htmlFor="tag">Tag</label>
            <input id="tag" type="text" list="tags" placeholder="e.g. happy" value={tag} onChange={(e) => { setTag(e.target.value); setOffset(0); }} />
            <datalist id="tags">{tags.map((t) => <option key={t.tag} value={t.tag} />)}</datalist>
          </div>
          <div className="field" style={{ maxWidth: 130, minWidth: 110 }}>
            <label htmlFor="limit">Limit (1–100)</label>
            <input
              id="limit" type="text" inputMode="numeric" value={limit}
              onChange={(e) => { setLimit(e.target.value.replace(/\D/g, '').slice(0, 3)); setOffset(0); }}
              onBlur={() => setLimit(String(limitNum))}
            />
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={related} onChange={(e) => { setRelated(e.target.checked); setOffset(0); }} /> Include related {noun}s
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
                : json.data.length === 0 || json.data.length === json.total ? `${json.total} ${noun}s`
                : `Showing ${json.offset + 1}–${json.offset + json.data.length} of ${json.total} ${noun}s`}
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
                  <small>{s.original ? 'GIF' : 'Sticker'} · {s.pack.name}</small>
                  <small>{s.tags.join(', ') || 'no tags'}</small>
                </div>
              ))}
            </div>
          )}

          {res.status === 200 && json.total > json.limit && (
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn" disabled={json.offset === 0 || loading} onClick={() => run(Math.max(0, json.offset - json.limit))}>← Previous</button>
              <span className="muted">Page {Math.floor(json.offset / json.limit) + 1} of {Math.ceil(json.total / json.limit)}</span>
              <button className="btn" disabled={json.offset + json.limit >= json.total || loading} onClick={() => run(json.offset + json.limit)}>Next →</button>
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