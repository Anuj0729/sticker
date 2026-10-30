'use client';
import { useCallback, useEffect, useState } from 'react';

import { API } from '@/lib/api';
import { useDialog } from '@/components/ui/DialogProvider';
const when = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString() : 'never');

export default function ApiKeys({ call, token, onLogout }) {
  const { confirm } = useDialog();
  const [data, setData] = useState(null);
  const [name, setName] = useState('');
  const [origins, setOrigins] = useState('');
  const [fresh, setFresh] = useState(null); // { key, name } shown once
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setData(await call('/admin/keys', { token })); }
    catch (e) { e.status === 401 ? onLogout() : setErr(e.message); }
  }, [call, token, onLogout]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn) => { setErr(''); try { await fn(); await load(); } catch (e) { setErr(e.message); } };

  const create = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await call('/admin/keys', { token, method: 'POST', body: { name, origins } });
      setFresh({ key: r.key, name: r.item.name }); setCopied(false); setName(''); setOrigins('');
    });
  };
  // Admin switch: key compulsory (ON) or optional (OFF)
  const toggleRequired = async () => {
    const next = !data.required;
    const ok = await confirm(next
      ? { title: 'Require an API key?', message: 'From now on every API request must send a valid key in the X-API-Key header. Apps that do not send one will get 401.', confirmText: 'Turn ON' }
      : { title: 'Make the API key optional?', message: 'The API will work for anyone, with or without a key. Sending a key becomes optional.', confirmText: 'Turn OFF', tone: 'danger' });
    if (!ok) return;
    setSaving(true); setErr('');
    try { await call('/admin/settings/api-key', { token, method: 'PATCH', body: { required: next } }); await load(); }
    catch (e) { e.status === 401 ? onLogout() : setErr(e.message); }
    finally { setSaving(false); }
  };

  const copy = async () => { try { await navigator.clipboard.writeText(fresh.key); setCopied(true); } catch {} };

  return (
    <>
      <div className="card" style={data && !data.required ? { borderColor: 'var(--danger)' } : undefined}>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap', alignItems: 'flex-start' }}>
          <div>
            <h2>Require API key</h2>
            {data === null ? <p className="muted" style={{ margin: '4px 0 0' }}>Loading…</p> : data.required ? (
              <p className="muted" style={{ margin: '4px 0 0' }}>
                <strong>ON.</strong> Every request to the sticker / GIF API must send a valid, enabled key in the <code>X-API-Key</code> header.
                Without it the API answers 401 (no / wrong key) or 403 (disabled key, or wrong website).
              </p>
            ) : (
              <p className="muted" style={{ margin: '4px 0 0' }}>
                <strong style={{ color: 'var(--danger)' }}>OFF.</strong> Sending a key is <strong>not</strong> required: anyone can call the API without one.
                If an app still sends a valid key, its name is used as the source in Analytics.
              </p>
            )}
          </div>
          {data && (
            <button type="button" role="switch" aria-checked={data.required} aria-label="Require API key" className="switch" disabled={saving} onClick={toggleRequired} />
          )}
        </div>
        <p className="muted" style={{ margin: '8px 0 0' }}>The key's name is also what shows up as the source in Analytics.</p>
      </div>

      <form className="card" onSubmit={create}>
        <h2>Create an API key</h2>
        <div className="row" style={{ marginTop: 10 }}>
          <input type="text" placeholder="Name, e.g. chat-android-app" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <input type="text" placeholder="Allowed websites (optional), e.g. mysite.com, app.mysite.com" value={origins} onChange={(e) => setOrigins(e.target.value)} />
          <button className="btn pri" disabled={!name.trim()}>Create key</button>
        </div>
        <p className="muted" style={{ margin: '8px 0 0' }}>
          For a website key, list its domains: the key then only works when called from those sites. Leave empty for mobile apps and servers.
          {data && !data.required && ' (The domain list is only checked when “Require API key” is ON.)'}
        </p>
        {err && <p className="err">{err}</p>}
      </form>

      {fresh && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <h2>Key for “{fresh.name}” created</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>Copy it now: for security it is stored hashed and <strong>cannot be shown again</strong>.</p>
          <div className="key">{fresh.key}</div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn pri" onClick={copy}>{copied ? 'Copied ✓' : 'Copy key'}</button>
            <button className="btn" onClick={() => setFresh(null)}>I have saved it</button>
          </div>
          <pre>{`GET ${API}/api/media?type=gif&tag=happy
X-API-Key: ${fresh.key}${data && !data.required ? '   # optional right now' : ''}
X-Platform: android`}</pre>
        </div>
      )}

      {data === null && !err && <p className="muted">Loading keys…</p>}
      {data?.keys.length === 0 && <p className="muted">{data.required ? 'No keys yet, so nobody can use the API. Create one above.' : 'No keys yet. Keys are optional right now, but you can create one to see which app is calling in Analytics.'}</p>}
      {data?.keys.length > 0 && (
        <div className="card">
          <div className="tscroll">
            <table className="atbl">
              <thead><tr><th>Name</th><th>Key</th><th>Status</th><th>Allowed websites</th><th className="num">Hits</th><th>Last used</th><th>Created</th><th></th></tr></thead>
              <tbody>
                {data.keys.map((k) => (
                  <tr key={k.id}>
                    <td><strong>{k.name}</strong></td>
                    <td><code>{k.prefix}…</code></td>
                    <td><span className={`pl ${k.enabled ? 'pl-android' : 'pl-other'}`}>{k.enabled ? 'Active' : 'Disabled'}</span></td>
                    <td className="muted">{k.origins.length ? k.origins.join(', ') : 'any'}</td>
                    <td className="num">{k.hits.toLocaleString()}</td>
                    <td className="muted nowrap">{when(k.lastUsedAt)}</td>
                    <td className="muted nowrap">{when(k.createdAt)}</td>
                    <td className="nowrap">
                      <button className="mini" onClick={() => run(() => call(`/admin/keys/${k.id}`, { token, method: 'PATCH', body: { enabled: !k.enabled } }))}>
                        {k.enabled ? 'Disable' : 'Enable'}
                      </button>{' '}
                      <button className="mini" style={{ color: 'var(--danger)' }} onClick={async () => {
                        if (await confirm({ title: `Delete key "${k.name}"?`, message: 'Anything using it stops working immediately.', confirmText: 'Delete', tone: 'danger' })) run(() => call(`/admin/keys/${k.id}`, { token, method: 'DELETE' }));
                      }}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}