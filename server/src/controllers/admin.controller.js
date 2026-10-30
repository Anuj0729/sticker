const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { ADMIN_PASSWORD, JWT_SECRET } = require('../config/env');
const { uploadBuffer, deleteByUrl } = require('../config/cloudinary');
const { sticker, cleanTags, kindOf } = require('../utils/media');

const UPLOAD_CONCURRENCY = 6;

// ---------- Admin auth ----------
const login = (req, res) => {
  const a = crypto.createHash('sha256').update(String(req.body.password || '')).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Wrong password' });
  res.json({ token: jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '12h' }) });
};

// ---------- Admin: packs (?kind=sticker|gif) ----------
const listPacks = (req, res) => {
  const kind = kindOf(req.query.kind);
  const packs = db.prepare('SELECT * FROM packs WHERE kind=? ORDER BY id DESC').all(kind).map((p) => ({
    ...p, published: !!p.published,
    stickers: db.prepare('SELECT * FROM stickers WHERE pack_id=? ORDER BY id').all(p.id).map((s) => sticker(s, kind)),
  }));
  res.json(packs);
};

const createPack = (req, res) => {
  const { name, author = '' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Pack name is required' });
  const r = db.prepare('INSERT INTO packs (name, author, kind) VALUES (?,?,?)').run(name.trim(), author.trim(), kindOf(req.body.kind));
  const pack = db.prepare('SELECT * FROM packs WHERE id=?').get(r.lastInsertRowid);
  res.status(201).json({ ...pack, published: !!pack.published, stickers: [] });
};

const updatePack = (req, res) => {
  const { name, author, published } = req.body;
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Pack name cannot be empty' });
  const r = db.prepare('UPDATE packs SET name=COALESCE(?,name), author=COALESCE(?,author), published=COALESCE(?,published) WHERE id=?')
    .run(name === undefined ? null : String(name).trim(), author === undefined ? null : String(author).trim(),
      published === undefined ? null : +!!published, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Pack not found' });
  res.json({ ok: true });
};

// Delete: the database is the source of truth, so answer right away and clean Cloudinary in the background.
const deletePack = (req, res) => {
  const files = db.prepare('SELECT file FROM stickers WHERE pack_id=?').all(req.params.id);
  db.prepare('DELETE FROM packs WHERE id=?').run(req.params.id);
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
};

const updateSticker = (req, res) => {
  db.prepare('UPDATE stickers SET tags=? WHERE id=?').run(cleanTags(req.body.tags), req.params.id);
  res.json({ ok: true });
};

const deleteSticker = (req, res) => {
  const s = db.prepare('SELECT file FROM stickers WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM stickers WHERE id=?').run(req.params.id);
  res.json({ ok: true });
  if (s) deleteByUrl(s.file); // background cleanup
};

module.exports = { login, listPacks, createPack, updatePack, deletePack, addStickers, updateSticker, deleteSticker };
