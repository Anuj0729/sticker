'use client';
import { call } from '@/lib/api';
import { useState } from 'react';

export default function Login({ onToken }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try { onToken((await call('/admin/login', { method: 'POST', body: { password: pw } })).token); }
    catch (e) { setErr(e.message); }
  };
  return (
    <div className="wrap login" style={{ maxWidth: 420, paddingTop: 96 }}>
      <h1>GaonGram Studio</h1>
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
