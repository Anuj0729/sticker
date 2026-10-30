// API keys, with an admin switch ("Require API key").
//
//   ON  : nobody can use the public sticker/GIF API unless the admin has issued them a key.
//         Callers send it as   X-API-Key: stk_...   (or ?api_key=stk_...)   on every /api request.
//   OFF : the key is optional. Calls without a key work. If a valid, enabled key IS sent, it is still
//         used to name the caller in Analytics (and its allowed-website list is still respected for that).
//
//   - Admin creates a key per app/website in the admin panel (name + optional allowed website origins).
//   - Admin can disable, re-enable or delete a key at any time; with the switch ON it stops working immediately.
//   - Only a SHA-256 hash of the key is stored. The full key is shown once, at creation.
//   - The switch is stored in the database (settings table). REQUIRE_API_KEY in .env only sets the
//     starting value the very first time; after that the admin panel decides.
const crypto = require('crypto');

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const hostOf = (u) => { try { return new URL(u).host.toLowerCase(); } catch { return ''; } };

// "https://app.example.com, example.com" -> ['app.example.com', 'example.com']
const parseOrigins = (v) => [...new Set(String(v || '').split(/[\s,]+/).map((x) => (x.includes('://') ? hostOf(x) : x.toLowerCase().replace(/\/.*$/, ''))).filter(Boolean))];

function init(db, { defaultRequired = true } = {}) {
  db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);`);
  db.exec(`
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,                -- shown as the "source" in analytics
  key_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,              -- first characters, to recognise the key in the admin list
  origins TEXT DEFAULT '',           -- comma separated allowed website hosts; empty = any (apps)
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT
);`);

  // ---- the admin switch ----
  const SETTING = 'require_api_key';
  const readSetting = db.prepare('SELECT value FROM settings WHERE key=?');
  const writeSetting = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  if (!readSetting.get(SETTING)) writeSetting.run(SETTING, defaultRequired ? '1' : '0'); // first run only
  let required = readSetting.get(SETTING).value === '1'; // kept in memory, so no DB read per request
  const setRequired = (on) => { required = !!on; writeSetting.run(SETTING, required ? '1' : '0'); };

  const byHash = db.prepare('SELECT * FROM api_keys WHERE key_hash=?');
  const touch = db.prepare('UPDATE api_keys SET last_used_at=CURRENT_TIMESTAMP WHERE id=?');

  // Is this key usable for this request? null = yes, otherwise the error to send.
  const problem = (k, req) => {
    if (!k) return { status: 401, error: 'Invalid API key' };
    if (!k.enabled) return { status: 403, error: 'This API key has been disabled by the admin' };
    const allowed = parseOrigins(k.origins);
    if (allowed.length) { // website key: the call must come from one of its sites
      const from = hostOf(req.headers.origin) || hostOf(req.headers.referer);
      if (!allowed.includes(from)) return { status: 403, error: 'This API key is not allowed from this website' };
    }
    return null;
  };

  // Runs on every /api request. `allow(req)` lets other trusted callers through (the chat server's usage reports).
  const authMiddleware = (allow = () => false) => (req, res, next) => {
    if (allow(req)) return next();
    const given = String(req.headers['x-api-key'] || req.query.api_key || '').trim();
    const k = given ? byHash.get(sha256(given)) : null;

    if (!required) { // key is optional: never block, but name the caller in Analytics when a good key is sent
      if (k && !problem(k, req)) { touch.run(k.id); res.locals.keyName = k.name; res.locals.keyId = k.id; }
      return next();
    }

    if (!given) return res.status(401).json({ error: 'API key required. Ask the admin for a key and send it as the X-API-Key header.' });
    const bad = problem(k, req);
    if (bad) return res.status(bad.status).json({ error: bad.error });
    touch.run(k.id);
    res.locals.keyName = k.name;
    res.locals.keyId = k.id;
    next();
  };

  const shape = (k) => ({
    id: k.id, name: k.name, prefix: k.prefix, origins: parseOrigins(k.origins), enabled: !!k.enabled,
    createdAt: k.created_at, lastUsedAt: k.last_used_at, hits: k.hits ?? 0,
  });
  const list = () => db.prepare(
    `SELECT k.*, (SELECT COUNT(*) FROM api_logs l WHERE l.key_name = k.name) AS hits FROM api_keys k ORDER BY k.id DESC`).all().map(shape);

  function adminRoutes(app, adminOnly) {
    app.get('/admin/keys', adminOnly, (_req, res) => res.json({ required, keys: list() }));

    // The admin switch: { required: true | false }
    app.patch('/admin/settings/api-key', adminOnly, (req, res) => {
      if (typeof req.body.required !== 'boolean') return res.status(400).json({ error: 'Send { "required": true } or { "required": false }' });
      setRequired(req.body.required);
      res.json({ required });
    });

    app.post('/admin/keys', adminOnly, (req, res) => {
      const name = String(req.body.name || '').trim().slice(0, 60);
      if (!name) return res.status(400).json({ error: 'Give the key a name (the app or website it is for)' });
      if (db.prepare('SELECT 1 FROM api_keys WHERE lower(name)=lower(?)').get(name)) return res.status(409).json({ error: 'A key with this name already exists' });
      const key = `stk_${crypto.randomBytes(24).toString('base64url')}`;
      const r = db.prepare('INSERT INTO api_keys (name,key_hash,prefix,origins) VALUES (?,?,?,?)')
        .run(name, sha256(key), key.slice(0, 8), parseOrigins(req.body.origins).join(','));
      res.status(201).json({ key, item: shape(db.prepare('SELECT * FROM api_keys WHERE id=?').get(r.lastInsertRowid)) }); // the only time the key is shown
    });

    app.patch('/admin/keys/:id', adminOnly, (req, res) => {
      const { enabled, origins } = req.body;
      const r = db.prepare('UPDATE api_keys SET enabled=COALESCE(?,enabled), origins=COALESCE(?,origins) WHERE id=?')
        .run(enabled === undefined ? null : +!!enabled, origins === undefined ? null : parseOrigins(origins).join(','), req.params.id);
      if (!r.changes) return res.status(404).json({ error: 'Key not found' });
      res.json({ ok: true });
    });

    app.delete('/admin/keys/:id', adminOnly, (req, res) => {
      const r = db.prepare('DELETE FROM api_keys WHERE id=?').run(req.params.id);
      if (!r.changes) return res.status(404).json({ error: 'Key not found' });
      res.json({ ok: true });
    });
  }

  return { authMiddleware, adminRoutes, isRequired: () => required };
}

module.exports = { init };