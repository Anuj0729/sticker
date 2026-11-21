const db = require('../config/db');
const { norm } = require('./media');

// The public API used to read the WHOLE catalog from the database on every request. Now the published items are
// kept in memory (with tags already split) and reloaded only when the admin changes something, or after TTL
// as a safety net (e.g. several server instances, or the database edited by hand).
const TTL_MS = 60 * 1000;
const cache = new Map(); // 'sticker' | 'gif' | 'all' -> { at, rows }

const load = (kind) => db.prepare(
  `SELECT s.*, p.name AS pack_name, p.kind AS kind FROM stickers s JOIN packs p ON p.id=s.pack_id
   WHERE p.published=1 AND (? IS NULL OR p.kind=?) ORDER BY s.id DESC`).all(kind, kind)
  .map((s) => ({ ...s, _tags: s.tags ? s.tags.split(',') : [], _packNorm: norm(s.pack_name) })); // note: use_count here may be stale, counts are read separately

// kind = 'sticker' | 'gif' | null (null = both)
const publishedItems = (kind) => {
  const key = kind || 'all';
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;
  const rows = load(kind);
  cache.set(key, { at: Date.now(), rows });
  return rows;
};

// Call after ANY change to packs / stickers (create, edit, publish, delete, upload)
const invalidateCatalog = () => cache.clear();

module.exports = { publishedItems, invalidateCatalog };
