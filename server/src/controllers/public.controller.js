const db = require('../config/db');
const { USAGE_KEY } = require('../config/env');
const { sticker, mediaUrl, norm } = require('../utils/media');
const { hasUsageKey } = require('../utils/usageKey');

// kind = 'sticker' | 'gif' | null (null = both, used by the unified /api/media)
const publishedItems = (kind) => db.prepare(
  `SELECT s.*, p.name AS pack_name, p.kind AS kind FROM stickers s JOIN packs p ON p.id=s.pack_id
   WHERE p.published=1 AND (? IS NULL OR p.kind=?) ORDER BY s.id DESC`).all(kind, kind);
// Same item shape as the live API: { id, packId, url, [original], tags, animated, pack, match } (no extra `type` field)
const shape = (s, match) => ({ ...sticker(s, s.kind), pack: { id: s.pack_id, name: s.pack_name }, match });

// ?type=sticker|gif|all (also accepts stickers / gifs). No type = all. Returns { ok, kind } (kind null = both).
const TYPE_MAP = { sticker: 'sticker', stickers: 'sticker', gif: 'gif', gifs: 'gif', all: null, '': null };
const typeParam = (v) => { const k = norm(v); return k in TYPE_MAP ? { ok: true, kind: TYPE_MAP[k] } : { ok: false }; };
// Resolves the kind for a handler: fixed by the route (legacy /api/stickers, /api/gifs) or chosen by ?type= (/api/media).
// Also tells the hit logger which kind this call was about and how many items it returned.
const resolveKind = (fixed, req, res) => {
  if (fixed) { res.locals.kind = fixed; return { ok: true, kind: fixed }; }
  const t = typeParam(req.query.type);
  if (!t.ok) { res.status(400).json({ error: "Invalid type. Use type=sticker, type=gif or type=all" }); return t; }
  res.locals.kind = t.kind || 'all';
  return t;
};

// One API for both:  GET /api/media?type=sticker|gif|all   (default: all)
// The old endpoints keep working:  /api/stickers  and  /api/gifs
// Same filters everywhere:
//   (no filter)           -> everything
//   ?pack=Cats            -> every item of pack "Cats" (name or id)
//   ?tag=happy            -> items tagged "happy" + related ones
//   ?pack=Cats&tag=happy  -> filters combine
//   &related=0 (no related), &limit=30&offset=0 (limit: 1-100)
const listHandler = (fixed) => (req, res) => {
  const { ok, kind } = resolveKind(fixed, req, res);
  if (!ok) return;
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
    data = rows.map((s) => shape(s, pack ? 'pack' : 'all'));
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
    data = [...direct.map((s) => shape(s, 'tag')), ...related.map((s) => shape(s, 'related'))];
  }

  res.locals.count = Math.min(Math.max(data.length - offset, 0), limit);
  // Search demand: remember WHAT was searched (only page 1, so "next page" clicks are not counted again).
  // results = how many items matched that term; 0 means we had nothing to offer for it.
  if (offset === 0) {
    const searched = [];
    const tagsOf = (s) => (s.tags ? s.tags.split(',') : []);
    for (const t of new Set(tagTerms)) searched.push({ kind: 'tag', term: t.slice(0, 40), results: rows.filter((s) => tagsOf(s).some((x) => x.includes(t))).length });
    if (pack) {
      const named = rows[0]?.pack_name;
      searched.push({ kind: 'pack', term: norm(/^\d+$/.test(pack) && named ? named : pack).slice(0, 40), results: rows.length });
    }
    res.locals.search = searched;
  }
  res.json({ total: data.length, matched, limit, offset, data: data.slice(offset, offset + limit) });
};

// Helpers for building UIs (pack picker, tag suggestions)
const packsHandler = (fixed) => (req, res) => {
  const { ok, kind } = resolveKind(fixed, req, res);
  if (!ok) return;
  const rows = db.prepare(`SELECT p.*, COUNT(s.id) AS count FROM packs p LEFT JOIN stickers s ON s.pack_id=p.id
    WHERE p.published=1 AND (? IS NULL OR p.kind=?) GROUP BY p.id ORDER BY p.id DESC`).all(kind, kind);
  res.locals.count = rows.length;
  res.json(rows.map((p) => {
    const first = db.prepare('SELECT * FROM stickers WHERE pack_id=? ORDER BY id LIMIT 1').get(p.id);
    return { id: p.id, type: p.kind, name: p.name, author: p.author, count: p.count, cover: first ? mediaUrl(first.file, p.kind) : null };
  }));
};

const tagsHandler = (fixed) => (req, res) => {
  const { ok, kind } = resolveKind(fixed, req, res);
  if (!ok) return;
  const counts = {};
  publishedItems(kind).forEach((s) => (s.tags ? s.tags.split(',') : []).forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
  res.locals.count = Object.keys(counts).length;
  res.json(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count })));
};

// Most used items (all time), highest first. Only items that were used at least once appear.
//   /api/stickers/popular?limit=12   and   /api/gifs/popular
const popularHandler = (fixed) => (req, res) => {
  const { ok, kind } = resolveKind(fixed, req, res);
  if (!ok) return;
  const limit = Math.min(Math.max(Math.floor(+req.query.limit) || 12, 1), 50);
  const rows = db.prepare(
    `SELECT s.*, p.name AS pack_name, p.kind AS kind FROM stickers s JOIN packs p ON p.id=s.pack_id
     WHERE p.published=1 AND (? IS NULL OR p.kind=?) AND s.use_count>0
     ORDER BY s.use_count DESC, s.last_used_at DESC, s.id DESC LIMIT ?`).all(kind, kind, limit);
  res.locals.count = rows.length;
  res.json({ total: rows.length, limit, data: rows.map((s) => ({ ...shape(s, 'popular'), uses: s.use_count })) });
};

// Count one use (called by the chat backend after a message with this item was sent).
// Protected by USAGE_KEY when it is set in .env.
const useHandler = (fixed) => (req, res) => {
  const { ok, kind } = resolveKind(fixed, req, res);
  if (!ok) return;
  if (USAGE_KEY && !hasUsageKey(req)) return res.status(401).json({ error: 'Invalid usage key' });
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const r = db.prepare(
    `UPDATE stickers SET use_count=COALESCE(use_count,0)+1, last_used_at=CURRENT_TIMESTAMP
     WHERE id=? AND pack_id IN (SELECT id FROM packs WHERE published=1 AND (? IS NULL OR kind=?))`).run(req.params.id, kind, kind);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  res.locals.count = 1;
  res.locals.used = { id: Number(req.params.id), kind: db.prepare('SELECT p.kind FROM stickers s JOIN packs p ON p.id=s.pack_id WHERE s.id=?').get(req.params.id).kind }; // for the "Most used" analytics
  res.json({ ok: true });
};

module.exports = { listHandler, packsHandler, tagsHandler, popularHandler, useHandler };