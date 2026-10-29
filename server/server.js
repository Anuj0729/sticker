require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { DatabaseSync } = require('node:sqlite'); // built into Node 22.13+, no compiling needed
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const { ensureConfigured, uploadBuffer, deleteByUrl, deliveryUrl } = require('./config/cloudinary');

const { PORT = 4000, ADMIN_PASSWORD, JWT_SECRET, ADMIN_ORIGIN = 'http://localhost:3000', USAGE_KEY = '' } = process.env;
if (!ADMIN_PASSWORD || !JWT_SECRET) throw new Error('Set ADMIN_PASSWORD and JWT_SECRET in .env');
ensureConfigured(); // fail fast if Cloudinary env vars are missing

// ---------- DB ----------
// One table of packs and one of items. packs.kind = 'sticker' | 'gif' decides which API serves them.
const db = new DatabaseSync(path.join(__dirname, 'stickers.db'));
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS packs (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, author TEXT DEFAULT '',
  published INTEGER DEFAULT 1, kind TEXT DEFAULT 'sticker', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS stickers (
  id INTEGER PRIMARY KEY, pack_id INTEGER NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  file TEXT NOT NULL, tags TEXT DEFAULT '', animated INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);`);

// Upgrade older databases
if (!db.prepare('PRAGMA table_info(packs)').all().some((c) => c.name === 'kind')) {
  db.exec("ALTER TABLE packs ADD COLUMN kind TEXT DEFAULT 'sticker'");
}
// Usage counters power the "most used" API (added later, so upgrade older databases)
{
  const cols = db.prepare('PRAGMA table_info(stickers)').all().map((c) => c.name);
  if (!cols.includes('use_count')) db.exec('ALTER TABLE stickers ADD COLUMN use_count INTEGER DEFAULT 0');
  if (!cols.includes('last_used_at')) db.exec('ALTER TABLE stickers ADD COLUMN last_used_at TEXT');
}
// The earlier standalone `gifs` table is folded into a GIF pack (one time)
if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='gifs'").get()) {
  const old = db.prepare('SELECT * FROM gifs').all();
  if (old.length) {
    const pid = db.prepare("INSERT INTO packs (name, kind) VALUES ('My GIFs', 'gif')").run().lastInsertRowid;
    const ins = db.prepare('INSERT INTO stickers (pack_id,file,tags,animated) VALUES (?,?,?,1)');
    old.forEach((g) => ins.run(pid, g.file, g.tags || ''));
  }
  db.exec('DROP TABLE gifs');
}

const UPLOAD_CONCURRENCY = 6;
const gifFit = (u) => u.replace('/upload/', '/upload/w_480,c_limit,q_auto/'); // lighter GIF, max 480px wide
const mediaUrl = (file, kind) => (kind === 'gif' ? gifFit(file) : deliveryUrl(file)); // `file` holds the Cloudinary secure_url
const sticker = (s, kind = 'sticker') => ({
  id: s.id, packId: s.pack_id, url: mediaUrl(s.file, kind),
  ...(kind === 'gif' && { original: s.file }),
  tags: s.tags ? s.tags.split(',') : [], animated: kind === 'gif' || !!s.animated,
});
const cleanTags = (t) => String(t || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).join(',');
const kindOf = (v) => (v === 'gif' ? 'gif' : 'sticker');

// ---------- App ----------
const app = express();
app.use(express.json());
app.use('/admin', cors({ origin: ADMIN_ORIGIN }));
app.use('/api', cors()); // public API: open to any website/app, no key needed

const upload = multer({ // stickers
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 20 },
  fileFilter: (_, f, cb) => cb(null, /^image\/(png|webp|gif|jpeg)$/.test(f.mimetype)),
});
const uploadGif = multer({ // GIF packs
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter: (_, f, cb) => cb(null, f.mimetype === 'image/gif'),
});

// ---------- Admin auth ----------
app.post('/admin/login', (req, res) => {
  const a = crypto.createHash('sha256').update(String(req.body.password || '')).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Wrong password' });
  res.json({ token: jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '12h' }) });
});

const adminOnly = (req, res, next) => {
  try { jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Login required' }); }
};

// ---------- Admin: packs (?kind=sticker|gif) ----------
app.get('/admin/packs', adminOnly, (req, res) => {
  const kind = kindOf(req.query.kind);
  const packs = db.prepare('SELECT * FROM packs WHERE kind=? ORDER BY id DESC').all(kind).map((p) => ({
    ...p, published: !!p.published,
    stickers: db.prepare('SELECT * FROM stickers WHERE pack_id=? ORDER BY id').all(p.id).map((s) => sticker(s, kind)),
  }));
  res.json(packs);
});

app.post('/admin/packs', adminOnly, (req, res) => {
  const { name, author = '' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Pack name is required' });
  const r = db.prepare('INSERT INTO packs (name, author, kind) VALUES (?,?,?)').run(name.trim(), author.trim(), kindOf(req.body.kind));
  const pack = db.prepare('SELECT * FROM packs WHERE id=?').get(r.lastInsertRowid);
  res.status(201).json({ ...pack, published: !!pack.published, stickers: [] });
});

app.patch('/admin/packs/:id', adminOnly, (req, res) => {
  const { name, author, published } = req.body;
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Pack name cannot be empty' });
  const r = db.prepare('UPDATE packs SET name=COALESCE(?,name), author=COALESCE(?,author), published=COALESCE(?,published) WHERE id=?')
    .run(name === undefined ? null : String(name).trim(), author === undefined ? null : String(author).trim(),
      published === undefined ? null : +!!published, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Pack not found' });
  res.json({ ok: true });
});

// Delete: the database is the source of truth, so answer right away and clean Cloudinary in the background.
app.delete('/admin/packs/:id', adminOnly, (req, res) => {
  const files = db.prepare('SELECT file FROM stickers WHERE pack_id=?').all(req.params.id);
  db.prepare('DELETE FROM packs WHERE id=?').run(req.params.id);
  res.json({ ok: true });
  files.forEach((s) => deleteByUrl(s.file)); // never throws
});

// ---------- Admin: items inside a pack (stickers or GIFs, decided by the pack) ----------
const pickUploader = (req, res, next) => {
  const pack = db.prepare('SELECT id, kind FROM packs WHERE id=?').get(req.params.id);
  if (!pack) return res.status(404).json({ error: 'Pack not found' });
  req.pack = pack;
  (pack.kind === 'gif' ? uploadGif.array('files', 10) : upload.array('files', 20))(req, res, next);
};

app.post('/admin/packs/:id/stickers', adminOnly, pickUploader, async (req, res, next) => {
  try {
    const pack = req.pack;
    const isGif = pack.kind === 'gif';
    if (!req.files?.length) {
      return res.status(400).json({ error: isGif ? 'Add GIF files (max 10 MB each)' : 'Add PNG, WebP, GIF or JPEG files (max 5 MB each)' });
    }

    const commonTags = req.body.tags;
    let perFile = [];
    try { perFile = JSON.parse(req.body.fileTags || '[]'); } catch {}
    // tags for all images + extra tags for each image, de-duplicated
    const tagsFor = (i) => [...new Set(cleanTags(`${commonTags || ''},${perFile[i] || ''}`).split(',').filter(Boolean))].join(',');
    // Upload all files to Cloudinary in parallel (a few at a time), then insert in the original order.
    const results = new Array(req.files.length);
    let next = 0;
    const worker = async () => {
      while (next < req.files.length) {
        const i = next++;
        const f = req.files[i];
        results[i] = await uploadBuffer(`${pack.id}/${crypto.randomUUID()}`, f.buffer);
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, req.files.length) }, worker));
    } catch (e) {
      results.forEach((r) => r && deleteByUrl(r.secure_url)); // don't leave orphans behind
      throw e;
    }

    const insert = db.prepare('INSERT INTO stickers (pack_id,file,tags,animated) VALUES (?,?,?,?)');
    const added = req.files.map((f, i) => {
      const tags = tagsFor(i);
      const animated = isGif || f.mimetype === 'image/gif' ? 1 : 0;
      const file = results[i].secure_url;
      const r = insert.run(pack.id, file, tags, animated);
      return sticker({ id: Number(r.lastInsertRowid), pack_id: pack.id, file, tags, animated }, pack.kind);
    });
    res.status(201).json({ added });
  } catch (e) { next(e); }
});

app.patch('/admin/stickers/:id', adminOnly, (req, res) => {
  db.prepare('UPDATE stickers SET tags=? WHERE id=?').run(cleanTags(req.body.tags), req.params.id);
  res.json({ ok: true });
});

app.delete('/admin/stickers/:id', adminOnly, (req, res) => {
  const s = db.prepare('SELECT file FROM stickers WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM stickers WHERE id=?').run(req.params.id);
  res.json({ ok: true });
  if (s) deleteByUrl(s.file); // background cleanup
});

// ---------- Public API (no key needed) ----------
// Tiny in-memory rate limit: 120 requests / minute / IP
const hits = new Map();
// Usage reports sent by your chat server carry the shared USAGE_KEY. Without that key
// anybody could inflate the counters, and every report would share one IP's rate limit.
const sha = (v) => crypto.createHash('sha256').update(String(v || '')).digest();
const hasUsageKey = (req) => !!USAGE_KEY && crypto.timingSafeEqual(sha(req.headers['x-usage-key']), sha(USAGE_KEY));

app.use('/api', (req, res, next) => {
  if (req.method === 'POST' && hasUsageKey(req)) return next();
  const now = Date.now();
  const h = hits.get(req.ip);
  if (!h || h.reset < now) { hits.set(req.ip, { count: 1, reset: now + 60000 }); return next(); }
  if (++h.count > 120) return res.status(429).json({ error: 'Too many requests, try again in a minute' });
  next();
});
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (v.reset < n) hits.delete(k); }, 60000).unref();

const norm = (v) => String(v || '').trim().toLowerCase();
const publishedItems = (kind) => db.prepare(
  `SELECT s.*, p.name AS pack_name FROM stickers s JOIN packs p ON p.id=s.pack_id
   WHERE p.published=1 AND p.kind=? ORDER BY s.id DESC`).all(kind);
const shape = (s, match, kind) => ({ ...sticker(s, kind), pack: { id: s.pack_id, name: s.pack_name }, match });

// Same filters for both APIs:
//   /api/stickers  and  /api/gifs
//   (no filter)           -> everything
//   ?pack=Cats            -> every item of pack "Cats" (name or id)
//   ?tag=happy            -> items tagged "happy" + related ones
//   ?pack=Cats&tag=happy  -> filters combine
//   &related=0 (no related), &limit=30&offset=0 (limit: 1-100)
const listHandler = (kind) => (req, res) => {
  const pack = norm(req.query.pack);
  const tagTerms = String(req.query.tag || '').split(',').map(norm).filter(Boolean);
  const limit = Math.min(Math.max(Math.floor(+req.query.limit) || 30, 1), 100);
  const offset = Math.max(Math.floor(+req.query.offset) || 0, 0);
  const wantRelated = !['0', 'false'].includes(String(req.query.related));

  let rows = publishedItems(kind);

  if (pack) {
    const byId = /^\d+$/.test(pack);
    let hit = rows.filter((s) => (byId ? String(s.pack_id) === pack : norm(s.pack_name) === pack));
    if (!hit.length && !byId) hit = rows.filter((s) => norm(s.pack_name).includes(pack)); // partial name
    rows = hit;
  }

  const needles = tagTerms;
  let data, matched;

  if (!needles.length) {
    data = rows.map((s) => shape(s, pack ? 'pack' : 'all', kind));
    matched = data.length;
  } else {
    const tagsOf = (s) => (s.tags ? s.tags.split(',') : []);
    const isDirect = (s) => needles.some((n) => tagsOf(s).some((t) => t.includes(n)));
    const direct = rows.filter(isDirect);
    matched = direct.length;

    let related = [];
    if (wantRelated && direct.length) {
      // tags that appear on matched items (other than what was searched) define "related"
      const common = new Set(direct.flatMap(tagsOf).filter((t) => !needles.some((n) => t.includes(n))));
      related = rows
        .filter((s) => !isDirect(s))
        .map((s) => ({ s, score: tagsOf(s).filter((t) => common.has(t)).length }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || b.s.id - a.s.id)
        .map((x) => x.s);
    }
    data = [...direct.map((s) => shape(s, 'tag', kind)), ...related.map((s) => shape(s, 'related', kind))];
  }

  res.json({ total: data.length, matched, limit, offset, data: data.slice(offset, offset + limit) });
};

// Helpers for building UIs (pack picker, tag suggestions)
const packsHandler = (kind) => (_, res) => {
  const rows = db.prepare(`SELECT p.*, COUNT(s.id) AS count FROM packs p LEFT JOIN stickers s ON s.pack_id=p.id
    WHERE p.published=1 AND p.kind=? GROUP BY p.id ORDER BY p.id DESC`).all(kind);
  res.json(rows.map((p) => {
    const first = db.prepare('SELECT * FROM stickers WHERE pack_id=? ORDER BY id LIMIT 1').get(p.id);
    return { id: p.id, name: p.name, author: p.author, count: p.count, cover: first ? mediaUrl(first.file, kind) : null };
  }));
};

const tagsHandler = (kind) => (_, res) => {
  const counts = {};
  publishedItems(kind).forEach((s) => (s.tags ? s.tags.split(',') : []).forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
  res.json(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count })));
};

// Most used items (all time), highest first. Only items that were used at least once appear.
//   /api/stickers/popular?limit=12   and   /api/gifs/popular
const popularHandler = (kind) => (req, res) => {
  const limit = Math.min(Math.max(Math.floor(+req.query.limit) || 12, 1), 50);
  const rows = db.prepare(
    `SELECT s.*, p.name AS pack_name FROM stickers s JOIN packs p ON p.id=s.pack_id
     WHERE p.published=1 AND p.kind=? AND s.use_count>0
     ORDER BY s.use_count DESC, s.last_used_at DESC, s.id DESC LIMIT ?`).all(kind, limit);
  res.json({ total: rows.length, limit, data: rows.map((s) => ({ ...shape(s, 'popular', kind), uses: s.use_count })) });
};

// Count one use (called by the chat backend after a message with this item was sent).
// Protected by USAGE_KEY when it is set in .env.
const useHandler = (kind) => (req, res) => {
  if (USAGE_KEY && !hasUsageKey(req)) return res.status(401).json({ error: 'Invalid usage key' });
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const r = db.prepare(
    `UPDATE stickers SET use_count=COALESCE(use_count,0)+1, last_used_at=CURRENT_TIMESTAMP
     WHERE id=? AND pack_id IN (SELECT id FROM packs WHERE published=1 AND kind=?)`).run(req.params.id, kind);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
};

app.get('/api/stickers/popular', popularHandler('sticker'));
app.post('/api/stickers/:id/use', useHandler('sticker'));
app.get('/api/gifs/popular', popularHandler('gif'));
app.post('/api/gifs/:id/use', useHandler('gif'));

app.get('/api/stickers', listHandler('sticker'));
app.get('/api/packs', packsHandler('sticker'));
app.get('/api/tags', tagsHandler('sticker'));

app.get('/api/gifs', listHandler('gif'));
app.get('/api/gif-packs', packsHandler('gif'));
app.get('/api/gifs/tags', tagsHandler('gif'));

app.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'A file is too large (stickers max 5 MB, GIFs max 10 MB)' });
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Too many files in one upload' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});
app.listen(PORT, () => console.log(`Sticker server on http://localhost:${PORT}`));