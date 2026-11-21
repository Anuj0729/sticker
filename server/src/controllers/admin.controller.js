const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { ADMIN_PASSWORD, JWT_SECRET } = require('../config/env');
const { uploadBuffer, deleteByUrl } = require('../config/cloudinary');
const { sticker, cleanTags, kindOf } = require('../utils/media');
const { loginFailed, loginSucceeded } = require('../middleware/rateLimit');
const { invalidateCatalog } = require('../utils/catalog');

const UPLOAD_CONCURRENCY = 6;

// ---------- Admin auth ----------
const login = (req, res) => {
  const a = crypto.createHash('sha256').update(String(req.body.password || '')).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  if (!crypto.timingSafeEqual(a, b)) { loginFailed(req); return res.status(401).json({ error: 'Wrong password' }); }
  loginSucceeded(req);
  res.json({ token: jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '12h' }) });
};

// ---------- Admin: packs (?kind=sticker|gif) ----------
const listPacks = (req, res) => {
  const kind = kindOf(req.query.kind);
  const byPack = new Map();
  db.prepare('SELECT s.* FROM stickers s JOIN packs p ON p.id=s.pack_id WHERE p.kind=? ORDER BY s.id').all(kind)
    .forEach((s) => { (byPack.get(s.pack_id) || byPack.set(s.pack_id, []).get(s.pack_id)).push(sticker(s, kind)); });
  const packs = db.prepare('SELECT * FROM packs WHERE kind=? ORDER BY id DESC').all(kind)
    .map((p) => ({ ...p, published: !!p.published, stickers: byPack.get(p.id) || [] }));
  res.json(packs);
};

const createPack = (req, res) => {
  const { name, author = '' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Pack name is required' });
  const r = db.prepare('INSERT INTO packs (name, author, kind) VALUES (?,?,?)').run(name.trim(), author.trim(), kindOf(req.body.kind));
  const pack = db.prepare('SELECT * FROM packs WHERE id=?').get(r.lastInsertRowid);
  invalidateCatalog();
  res.status(201).json({ ...pack, published: !!pack.published, stickers: [] });
};

const updatePack = (req, res) => {
  const { name, author, published } = req.body;
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Pack name cannot be empty' });
  const r = db.prepare('UPDATE packs SET name=COALESCE(?,name), author=COALESCE(?,author), published=COALESCE(?,published) WHERE id=?')
    .run(name === undefined ? null : String(name).trim(), author === undefined ? null : String(author).trim(),
      published === undefined ? null : +!!published, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Pack not found' });
  invalidateCatalog();
  res.json({ ok: true });
};

// Delete: the database is the source of truth, so answer right away and clean Cloudinary in the background.
const deletePack = (req, res) => {
  const files = db.prepare('SELECT file FROM stickers WHERE pack_id=?').all(req.params.id);
  db.prepare('DELETE FROM packs WHERE id=?').run(req.params.id);
  invalidateCatalog();
  res.json({ ok: true });
  files.forEach((s) => deleteByUrl(s.file)); // never throws
};

const addStickers = async (req, res, next) => {
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
    let cursor = 0, failure = null;
    const worker = async () => {
      while (!failure && cursor < req.files.length) { // stop picking new files once one upload has failed
        const i = cursor++;
        try { results[i] = await uploadBuffer(`${pack.id}/${crypto.randomUUID()}`, req.files[i].buffer); }
        catch (e) { failure = failure || e; }
      }
    };
    // allSettled waits for EVERY worker, so nothing is still uploading when we clean up (no orphans left behind)
    await Promise.allSettled(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, req.files.length) }, worker));
    const cleanup = () => results.forEach((r) => r && deleteByUrl(r.secure_url));
    if (failure) { cleanup(); throw failure; }

    // All inserts succeed together or none do (one transaction); on failure remove the uploaded files too.
    const insert = db.prepare('INSERT INTO stickers (pack_id,file,tags,animated) VALUES (?,?,?,?)');
    let added;
    db.exec('BEGIN');
    try {
      added = req.files.map((f, i) => {
        const tags = tagsFor(i);
        const animated = isGif || f.mimetype === 'image/gif' ? 1 : 0;
        const file = results[i].secure_url;
        const r = insert.run(pack.id, file, tags, animated);
        return sticker({ id: Number(r.lastInsertRowid), pack_id: pack.id, file, tags, animated }, pack.kind);
      });
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      cleanup();
      throw e;
    }
    invalidateCatalog();
    res.status(201).json({ added });
  } catch (e) { next(e); }
};

const updateSticker = (req, res) => {
  db.prepare('UPDATE stickers SET tags=? WHERE id=?').run(cleanTags(req.body.tags), req.params.id);
  invalidateCatalog();
  res.json({ ok: true });
};

const deleteSticker = (req, res) => {
  const s = db.prepare('SELECT file FROM stickers WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM stickers WHERE id=?').run(req.params.id);
  invalidateCatalog();
  res.json({ ok: true });
  if (s) deleteByUrl(s.file); // background cleanup
};

module.exports = { login, listPacks, createPack, updatePack, deletePack, addStickers, updateSticker, deleteSticker };
