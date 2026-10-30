'use client';
import { call } from '@/lib/api';
import { TABS } from '@/lib/constants';
import { useEffect, useRef, useState } from 'react';
import Analytics from './analytics/Analytics';
import ApiKeys from './api-keys/ApiKeys';
import Packs from './packs/Packs';

export default function Dashboard({ token, onLogout }) {
  const [kind, setKind] = useState('sticker');
  // remember the open tab across reloads
  useEffect(() => { try { const t = localStorage.getItem('sticker_tab'); if (TABS.some(([k]) => k === t)) setKind(t); } catch {} }, []);
  const selectTab = (k) => { setKind(k); try { localStorage.setItem('sticker_tab', k); } catch {} };
  // sliding indicator: follows the active tab (also on resize / font load)
  const tabsRef = useRef(null);
  const [ind, setInd] = useState({ x: 0, w: 0 });
  useEffect(() => {
    const measure = () => {
      const el = tabsRef.current?.querySelector('.tab.on');
      if (!el) return;
      setInd({ x: el.offsetLeft, w: el.offsetWidth });
      el.scrollIntoView?.({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    };
    measure();
    window.addEventListener('resize', measure);
    document.fonts?.ready.then(measure);
    return () => window.removeEventListener('resize', measure);
  }, [kind]);
  return (
    <div className="wrap">
      <div className="top">
        <h1>GaonGram Studio</h1>
        <div className="row">
          <a className="btn" href="/tester" target="_blank" rel="noreferrer">API tester ↗</a>
          <button className="btn" onClick={onLogout}>Sign out</button>
        </div>
      </div>
      <div className="tabs has-ind" role="tablist" ref={tabsRef}>
        <span className="tab-ind" aria-hidden="true" style={{ transform: `translateX(${ind.x}px)`, width: ind.w }} />
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={kind === k} className={`tab${kind === k ? ' on' : ''}`} onClick={() => selectTab(k)}>
            {label}
          </button>
        ))}
      </div>
      <div key={kind} className="view">
      {kind === 'analytics' ? <Analytics call={call} token={token} onLogout={onLogout} />
        : kind === 'keys' ? <ApiKeys call={call} token={token} onLogout={onLogout} />
        : <Packs key={kind} kind={kind} token={token} onLogout={onLogout} />}
      </div>
    </div>
  );
}
