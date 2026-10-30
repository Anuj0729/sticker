'use client';
import { useRef, useState } from 'react';
import { call } from '@/lib/api';
import { useDialog } from '@/components/ui/DialogProvider';

export default function StickerTile({ s, noun, token, act, onTags, onRemove }) {
  const { confirm } = useDialog();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');

  const start = () => { setVal(s.tags.join(', ')); setEditing(true); };
  const save = () => {
    onTags(val.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean));
    setEditing(false);
    act(() => call(`/admin/stickers/${s.id}`, { token, method: 'PATCH', body: { tags: val } }));
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete this ${noun}?`,
      message: `It will be removed from the pack for good. This cannot be undone.`,
      confirmText: `Delete ${noun}`, tone: 'danger',
      preview: { src: s.url, alt: s.tags.join(' ') || noun, tags: s.tags },
    });
    if (!ok) return;
    onRemove();
    act(() => call(`/admin/stickers/${s.id}`, { token, method: 'DELETE' }));
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
      <button className="x" aria-label={`Delete ${noun}`} onClick={remove}>×</button>
    </div>
  );
}
