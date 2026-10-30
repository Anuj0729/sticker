'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from '@/lib/api';
import { KINDS } from '@/lib/constants';
import StickerTile from './StickerTile';
import { useDialog } from '@/components/ui/DialogProvider';

export default function PackCard({ pack, kind, token, act, patchPack, removePack }) {
  const { confirm } = useDialog();
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
              <button className="btn del" onClick={async () => {
                if (!(await confirm({ title: `Delete "${pack.name}"?`, message: `This also deletes all its ${cfg.noun}s. This cannot be undone.`, confirmText: 'Delete pack', tone: 'danger' }))) return;
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
