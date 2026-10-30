'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// Replaces the browser's confirm() / alert() with an in-app modal.
//
//   const { confirm, alert } = useDialog();
//   if (await confirm({ title: 'Delete pack?', message: '…', confirmText: 'Delete', tone: 'danger' })) { … }
//   await alert({ title: 'Saved', message: '…' });
//
// A plain string is also accepted:  await confirm('Are you sure?')
// Optional preview (e.g. the item being deleted):  preview: { src, alt, tags: ['happy', 'cat'] }
// tone: 'default' | 'danger'. confirm() resolves true / false, alert() resolves when closed.

const DialogContext = createContext(null);

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used inside <DialogProvider>');
  return ctx;
}

const norm = (o) => (typeof o === 'string' ? { message: o } : o || {});

export function DialogProvider({ children }) {
  const [dlg, setDlg] = useState(null); // { kind, title, message, confirmText, cancelText, tone, resolve }
  const queue = useRef([]);
  const current = useRef(null);
  const confirmRef = useRef(null);
  const cancelRef = useRef(null);
  const lastFocus = useRef(null);

  const showNext = useCallback(() => {
    const next = queue.current.shift() || null;
    current.current = next;
    setDlg(next);
  }, []);

  const open = useCallback((kind, opts) => new Promise((resolve) => {
    const d = { kind, tone: 'default', ...norm(opts), resolve };
    if (current.current) queue.current.push(d);
    else { lastFocus.current = document.activeElement; current.current = d; setDlg(d); }
  }), []);

  const close = useCallback((result) => {
    const d = current.current;
    if (!d) return;
    d.resolve(d.kind === 'confirm' ? result : undefined);
    showNext();
    if (!queue.current.length && !current.current) lastFocus.current?.focus?.();
  }, [showNext]);

  // keyboard: Esc cancels, Tab stays inside the dialog
  useEffect(() => {
    if (!dlg) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      if (e.key === 'Tab') {
        const els = [cancelRef.current, confirmRef.current].filter(Boolean);
        if (!els.length) return;
        const i = els.indexOf(document.activeElement);
        e.preventDefault();
        els[(i + (e.shiftKey ? -1 : 1) + els.length) % els.length].focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // danger: focus Cancel first so a stray Enter cannot delete something
    (dlg.tone === 'danger' && cancelRef.current ? cancelRef.current : confirmRef.current)?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [dlg, close]);

  const api = useRef({
    confirm: (o) => open('confirm', o),
    alert: (o) => open('alert', o),
  }).current;

  return (
    <DialogContext.Provider value={api}>
      {children}
      {dlg && (
        <div className="dlg-back" onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }}>
          <div className={`dlg dlg-${dlg.tone}`} role={dlg.kind === 'alert' ? 'alertdialog' : 'dialog'} aria-modal="true"
            aria-labelledby="dlg-title" aria-describedby="dlg-msg">
            <div className="dlg-icon" aria-hidden="true">{dlg.tone === 'danger' ? '!' : dlg.kind === 'alert' ? 'i' : '?'}</div>
            <h2 id="dlg-title">{dlg.title || (dlg.kind === 'alert' ? 'Notice' : 'Are you sure?')}</h2>
            {dlg.message && <p id="dlg-msg" className="dlg-msg">{dlg.message}</p>}
            {dlg.preview && (
              <div className="dlg-preview">
                {dlg.preview.src && <img src={dlg.preview.src} alt={dlg.preview.alt || ''} />}
                {dlg.preview.tags && (
                  <div className="dlg-tags" aria-label="Tags">
                    {dlg.preview.tags.length
                      ? dlg.preview.tags.map((tg) => <span key={tg} className="dlg-tag">{tg}</span>)
                      : <span className="dlg-notag">No tags</span>}
                  </div>
                )}
              </div>
            )}
            <div className="dlg-actions">
              {dlg.kind === 'confirm' && (
                <button type="button" className="btn" ref={cancelRef} onClick={() => close(false)}>{dlg.cancelText || 'Cancel'}</button>
              )}
              <button type="button" ref={confirmRef} className={`btn ${dlg.tone === 'danger' ? 'dlg-danger' : 'pri'}`} onClick={() => close(true)}>
                {dlg.confirmText || (dlg.kind === 'alert' ? 'OK' : 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}
