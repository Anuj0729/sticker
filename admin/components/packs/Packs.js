'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { call, notify } from '@/lib/api';
import { KINDS } from '@/lib/constants';
import PackCard from './PackCard';

export default function Packs({ kind, token, onLogout }) {
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
