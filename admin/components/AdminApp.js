'use client';
import { useEffect, useState } from 'react';
import Login from './auth/Login';
import Dashboard from './Dashboard';
import { DialogProvider } from './ui/DialogProvider';

export default function AdminApp() {
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
  return (
    <DialogProvider>
      {token ? <Dashboard token={token} onLogout={() => save(null)} /> : <Login onToken={save} />}
    </DialogProvider>
  );
}
