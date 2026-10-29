'use client';
import { useEffect, useState, useCallback, useRef } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// Tells other open tabs (like /tester) that packs/stickers changed
const notify = () => {
  try { const c = new BroadcastChannel('sticker-studio'); c.postMessage('changed'); c.close(); } catch {}
};

async function call(path, { token, method = 'GET', body, form } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(body && { 'Content-Type': 'application/json' }),
    },
    body: form || (body && JSON.stringify(body)),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
  return data;
}

export default function Page() {
  const [token, setToken] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try { setToken(localStorage.getItem('sticker_token')); } catch {}
    setReady(true);
  }, []);

  const save = (t) => {
    setToken(t);
    try { t ? localStorage.setItem('sticker_token', t) : localStorage.removeItem('sticker_token'); } catch {}
  };

  if (!ready) return null;
  return token ? <Dashboard token={token} onLogout={() => save(null)} /> : <Login onToken={save} />;
}

function Login({ onToken }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try { onToken((await call('/admin/login', { method: 'POST', body: { password: pw } })).token); }
    catch (e) { setErr(e.message); }
  };
  return (
    <div className="wrap" style={{ maxWidth: 420, paddingTop: 96 }}>
      <h1>Sticker Studio</h1>
      <p className="muted">Sign in to manage packs and API keys.</p>
      <form className="card" onSubmit={submit}>
        <div className="row">
          <input type="password" placeholder="Admin password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          <button className="btn pri">Sign in</button>
        </div>
        {err && <p className="err">{err}</p>}
      </form>
    </div>
  );
}

// Per-kind settings: stickers and GIFs share one UI, only the limits and wording differ (server enforces the same)
const KINDS = {
  sticker: { noun: 'sticker', label: 'Stickers', accept: 'image/png,image/webp,image/gif,image/jpeg', maxMb: 5, maxFiles: 20 },
  gif: { noun: 'GIF', label: 'GIFs', accept: 'image/gif', maxMb: 10, maxFiles: 10 },
};

function Dashboard({ token, onLogout }) {
  const [kind, setKind] = useState('sticker');
  return (
    <div className="wrap">
      <div className="top">
        <h1>Sticker Studio</h1>
        <div className="row">
          <a className="btn" href="/tester" target="_blank" rel="noreferrer">API tester ↗</a>
          <button className="btn" onClick={onLogout}>Sign out</button>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {Object.entries(KINDS).map(([k, c]) => (
          <button key={k} role="tab" aria-selected={kind === k} className={`tab${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>
            {c.label}
          </button>
        ))}
      </div>
      <Packs key={kind} kind={kind} token={token} onLogout={onLogout} />
    </div>
  );
}

function Packs({ kind, token, onLogout }) {
  const cfg = KINDS[kind];
  const [packs, setPacks] = useState(null);
  const [name, setName] = useState('');
  const [author, setAuthor] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try { setPacks(await call(`/admin/packs?kind=${kind}`, { token })); }
    catch (e) { e.status === 401 ? onLogout() : setErr(e.message); }
  }, [token, kind, onLogout]);
  useEffect(() => { load(); }, [load]);

  // Runs a request and tells other tabs. The screen is updated locally (no full reload), so it feels instant.
  // If a request fails we reload from the server to get back to the true state.
  const act = async (fn) => {
    setErr('');
    try { await fn(); notify(); }
    catch (e) { setErr(e.message); load(); }
  };
  const patchPack = (id, fn) => setPacks((ps) => ps && ps.map((p) => (p.id === id ? fn(p) : p)));

  const create = (e) => {
    e.preventDefault();
    if (!name.trim()) return setErr('Pack name is required');
    act(async () => {
      const pack = await call('/admin/packs', { token, method: 'POST', body: { name, author, kind } });
      setPacks((ps) => [pack, ...(ps || [])]);
      setName(''); setAuthor('');
    });
  };

  return (
    <>
      <form className="card" onSubmit={create}>
        <h2>New {cfg.noun} pack</h2>
        <div className="row" style={{ marginTop: 10 }}>
          <input type="text" placeholder="Pack name" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="text" placeholder="Author (optional)" value={author} onChange={(e) => setAuthor(e.target.value)} />
          <button className="btn pri">Create pack</button>
        </div>
        {err && <p className="err">{err}</p>}
      </form>

      {packs === null && <p className="muted">Loading packs…</p>}
      {packs?.length === 0 && <p className="muted">No {cfg.noun} packs yet. Create one above, then add {cfg.noun}s to it.</p>}
      {packs?.map((p) => <PackCard key={p.id} pack={p} kind={kind} token={token} act={act} patchPack={patchPack} removePack={(id) => setPacks((ps) => ps.filter((x) => x.id !== id))} />)}
    </>
  );
}

function PackCard({ pack, kind, token, act, patchPack, removePack }) {
  const cfg = KINDS[kind];
  const isGif = kind === 'gif';
  const BIG = cfg.maxMb * 1024 * 1024;
  // Each picked image keeps its own tags: { id, file, src, tags }
  const [items, setItems] = useState([]);
  const [tags, setTags] = useState(''); // tags applied to every image
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  // Free the local preview URLs when this card goes away
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => () => itemsRef.current.forEach((i) => URL.revokeObjectURL(i.src)), []);

  const [renaming, setRenaming] = useState(false);
  const [rName, setRName] = useState('');
  const [rAuthor, setRAuthor] = useState('');
  const startRename = () => { setRName(pack.name); setRAuthor(pack.author || ''); setRenaming(true); };
  const saveRename = (e) => {
    e.preventDefault();
    const name = rName.trim(), author = rAuthor.trim();
    if (!name) return;
    patchPack(pack.id, (p) => ({ ...p, name, author }));
    setRenaming(false);
    act(() => call(`/admin/packs/${pack.id}`, { token, method: 'PATCH', body: { name, author } }));
  };

  const tooBig = items.some((i) => i.file.size > BIG);

  const pick = (e) => {
    const picked = [...e.target.files].filter((f) => !isGif || f.type === 'image/gif').slice(0, Math.max(0, cfg.maxFiles - items.length));
    e.target.value = ''; // lets you pick the same file again later
    // Tag defaults to the file name (without extension); you can edit it before uploading
    const added = picked.map((file) => ({ id: Math.random().toString(36).slice(2), file, src: URL.createObjectURL(file), tags: file.name.replace(/\.[^.]+$/, '').replace(/,/g, ' ').trim() }));
    setItems((prev) => [...prev, ...added]);
  };
  const setItemTags = (id, v) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, tags: v } : i)));
  const removeItem = (id) => setItems((prev) => {
    prev.filter((i) => i.id === id).forEach((i) => URL.revokeObjectURL(i.src));
    return prev.filter((i) => i.id !== id);
  });
  const clearAll = () => { items.forEach((i) => URL.revokeObjectURL(i.src)); setItems([]); };

  const upload = () => act(async () => {
    setBusy(true);
    try {
      const form = new FormData();
      items.forEach((i) => form.append('files', i.file));
      form.append('tags', tags); // for all images
      form.append('fileTags', JSON.stringify(items.map((i) => i.tags))); // one entry per image, same order
      const r = await call(`/admin/packs/${pack.id}/stickers`, { token, method: 'POST', form });
      patchPack(pack.id, (p) => ({ ...p, stickers: [...p.stickers, ...r.added] }));
      setNote('');
      clearAll(); setTags('');
    } finally { setBusy(false); }
  });

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        {renaming ? (
          <form className="row" style={{ flex: 1 }} onSubmit={saveRename}>
            <input type="text" autoFocus aria-label="Pack name" placeholder="Pack name" value={rName}
              onChange={(e) => setRName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)} />
            <input type="text" aria-label="Author" placeholder="Author (optional)" value={rAuthor}
              onChange={(e) => setRAuthor(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)} />
            <button className="btn pri" disabled={!rName.trim()}>Save</button>
            <button type="button" className="btn" onClick={() => setRenaming(false)}>Cancel</button>
          </form>
        ) : (
          <>
            <div>
              <h2>{pack.name}</h2>
              <span className="muted">{pack.author || 'No author'} · {pack.stickers.length} {cfg.noun}s · ID {pack.id}</span>
            </div>
            <div className="row">
              <button className="btn" onClick={startRename}>Edit name</button>
              <button className="btn" onClick={() => {
                const published = !pack.published;
                patchPack(pack.id, (p) => ({ ...p, published }));
                act(() => call(`/admin/packs/${pack.id}`, { token, method: 'PATCH', body: { published } }));
              }}>
                {pack.published ? 'Unpublish' : 'Publish'}
              </button>
              <button className="btn del" onClick={() => {
                if (!confirm(`Delete "${pack.name}" and all its ${cfg.noun}s?`)) return;
                removePack(pack.id);
                act(() => call(`/admin/packs/${pack.id}`, { token, method: 'DELETE' }));
              }}>
                Delete pack
              </button>
            </div>
          </>
        )}
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        <input type="file" accept={cfg.accept} multiple onChange={pick} />
      </div>

      {items.length > 0 && (
        <div className="preview">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>Preview · {items.length} to upload</strong>
            <button className="btn" onClick={clearAll}>Clear</button>
          </div>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Each image's tag is its file name by default - edit it if you want. It is added to the tags for all images{tags ? ` (${tags})` : ''}.
          </p>
          <div className="grid">
            {items.map((i) => (
              <div className="st" key={i.id}>
                <img src={i.src} alt={i.file.name} />
                <small title={i.file.name}>{i.file.name}</small>
                <small style={i.file.size > BIG ? { color: 'var(--danger)' } : undefined}>
                  {(i.file.size / 1024).toFixed(0)} KB{i.file.size > BIG ? ' · too big' : ''}
                </small>
                <div className="tagedit">
                  <input
                    type="text" aria-label={`Tags for ${i.file.name}`} placeholder="tags (default: file name)"
                    value={i.tags} onChange={(e) => setItemTags(i.id, e.target.value)}
                  />
                </div>
                <button className="x" aria-label="Remove from preview" onClick={() => removeItem(i.id)}>×</button>
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn pri" disabled={busy || tooBig} onClick={upload}>
              {busy ? 'Uploading…' : `Upload ${items.length} ${cfg.noun}${items.length > 1 ? 's' : ''}`}
            </button>
            {tooBig && <span className="err" style={{ margin: 0 }}>Remove files above {cfg.maxMb} MB first.</span>}
          </div>
        </div>
      )}

      {note && <p className="muted">{note}</p>}

      {pack.stickers.length === 0 ? (
        <p className="muted">This pack is empty. Pick up to {cfg.maxFiles} {isGif ? 'GIF files' : 'images'}, check the preview, then upload.</p>
      ) : (
        <div className="grid">
          {pack.stickers.map((s) => <StickerTile key={s.id} s={s} noun={cfg.noun} token={token} act={act}
            onTags={(tags) => patchPack(pack.id, (p) => ({ ...p, stickers: p.stickers.map((x) => (x.id === s.id ? { ...x, tags } : x)) }))}
            onRemove={() => patchPack(pack.id, (p) => ({ ...p, stickers: p.stickers.filter((x) => x.id !== s.id) }))} />)}
        </div>
      )}
    </div>
  );
}

function StickerTile({ s, noun, token, act, onTags, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');

  const start = () => { setVal(s.tags.join(', ')); setEditing(true); };
  const save = () => {
    onTags(val.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean));
    setEditing(false);
    act(() => call(`/admin/stickers/${s.id}`, { token, method: 'PATCH', body: { tags: val } }));
  };

  return (
    <div className="st">
      <img src={s.url} alt={s.tags.join(' ') || noun} loading="lazy" />
      {editing ? (
        <div className="tagedit">
          <input
            type="text" autoFocus aria-label="Tags" placeholder="happy, party" value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          />
          <div className="row" style={{ gap: 4, justifyContent: 'center' }}>
            <button className="mini pri" onClick={save}>Save</button>
            <button className="mini" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="tagline" onClick={start} title="Click to edit tags">
          {s.tags.join(', ') || 'add tags'} ✎
        </button>
      )}
      <button className="x" aria-label={`Delete ${noun}`} onClick={() => { onRemove(); act(() => call(`/admin/stickers/${s.id}`, { token, method: 'DELETE' })); }}>×</button>
    </div>
  );
}
