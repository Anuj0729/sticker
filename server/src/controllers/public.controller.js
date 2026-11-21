const db = require('../config/db');
const { USAGE_KEY } = require('../config/env');
const { sticker, mediaUrl, norm } = require('../utils/media');
const { hasUsageKey, verifyUserToken } = require('../utils/usageKey');
const { publishedItems } = require('../utils/catalog'); // cached in memory, reloaded when the admin changes something

// Same item shape as the live API: { id, packId, url, [original], tags, animated, pack, match } (no extra `type` field)
const shape = (s, match) => ({ ...sticker(s, s.kind), pack: { id: s.pack_id, name: s.pack_name }, match });

// Who is the user? Personal data must NOT be chosen by the caller (otherwise anyone could read anyone's history), so:
//   - your chat SERVER sends X-Usage-Key + X-User-Id      (server to server), or
//   - the app sends X-User-Token, a token your chat server signed for that user (see utils/usageKey.js).
// Anything else (or no USAGE_KEY configured) = no user: the call is treated as anonymous / global.
const SAFE_ID = /^[A-Za-z0-9._:@-]{1,64}$/;
const userIdOf = (req) => {
  if (!USAGE_KEY) return '';
  const id = hasUsageKey(req)
    ? String(req.headers['x-user-id'] || req.query.userId || '').trim()
    : verifyUserToken(req.headers['x-user-token']);
  return SAFE_ID.test(id) ? id : '';
};
const userUsesMap = (uid) => new Map(db.prepare('SELECT item_id, use_count FROM user_uses WHERE user_id=?').all(uid).map((r) => [r.item_id, r.use_count]));
const globalUsesMap = () => new Map(db.prepare('SELECT id, use_count FROM stickers WHERE use_count>0').all().map((r) => [r.id, r.use_count]));

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
    let hit = rows.filter((s) => (byId ? String(s.pack_id) === pack : s._packNorm === pack));
    if (!hit.length && !byId) hit = rows.filter((s) => s._packNorm.includes(pack)); // partial name
    rows = hit;
  }

  // `data` holds light entries { s, match }; the full JSON shape is built only for the items actually returned
  const needles = tagTerms;
  let data, matched;

  if (!needles.length) {
    data = rows.map((s) => ({ s, match: pack ? 'pack' : 'all' }));
    matched = data.length;
  } else {
    const isDirect = (s) => needles.some((n) => s._tags.some((t) => t.includes(n)));
    const direct = rows.filter(isDirect);
    matched = direct.length;

    let related = [];
    if (wantRelated && direct.length) {
      // tags that appear on matched items (other than what was searched) define "related"
      const common = new Set(direct.flatMap((s) => s._tags).filter((t) => !needles.some((n) => t.includes(n))));
      related = rows
        .filter((s) => !isDirect(s))
        .map((s) => ({ s, score: s._tags.filter((t) => common.has(t)).length }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || b.s.id - a.s.id)
        .map((x) => x.s);
    }
    data = [...direct.map((s) => ({ s, match: 'tag' })), ...related.map((s) => ({ s, match: 'related' }))];
  }

  res.locals.count = Math.min(Math.max(data.length - offset, 0), limit);
  // Search demand: remember WHAT was searched (only page 1, so "next page" clicks are not counted again).
  // results = how many items matched that term; 0 means we had nothing to offer for it.
  if (offset === 0) {
    const searched = [];
    for (const t of new Set(tagTerms)) searched.push({ kind: 'tag', term: t.slice(0, 40), results: rows.filter((s) => s._tags.some((x) => x.includes(t))).length });
    if (pack) {
      const named = rows[0]?.pack_name;
      searched.push({ kind: 'pack', term: norm(/^\d+$/.test(pack) && named ? named : pack).slice(0, 40), results: rows.length });
    }
    res.locals.search = searched;
  }

  const pl = Number.isFinite(+req.query.popular_limit) && req.query.popular_limit !== undefined && req.query.popular_limit !== ''
    ? Math.min(Math.max(Math.floor(+req.query.popular_limit), 0), 30) : 10;
  // With a verified user: "popular" = THIS user's most used items; otherwise the global counts (read fresh, not from the cache)
  const uid = userIdOf(req);
  const usesOf = uid ? userUsesMap(uid) : globalUsesMap();
  const popularAll = data
    .filter((d) => d.match !== 'related' && (usesOf.get(d.s.id) || 0) > 0)
    .sort((a, b) => (usesOf.get(b.s.id) || 0) - (usesOf.get(a.s.id) || 0))
    .slice(0, pl);
  const popIds = new Set(popularAll.map((d) => d.s.id));
  const recentAll = data.filter((d) => !popIds.has(d.s.id));
  const out = (d) => shape(d.s, d.match);

  res.json({
    total: data.length, matched, limit, offset,
    ...(offset === 0 && popularAll.length > 0 && { popular: popularAll.map((d) => ({ ...out(d), uses: usesOf.get(d.s.id) })) }),
    recent: recentAll.slice(offset, offset + limit).map(out),
    recentTotal: recentAll.length,
    data: data.slice(offset, offset + limit).map(out),
  });
};

const packsHandler = (fixed) => (req, res) => {
  const { ok, kind } = resolveKind(fixed, req, res);
  if (!ok) return;
  const rows = db.prepare(
    `SELECT p.*, COUNT(s.id) AS count, (SELECT file FROM stickers WHERE pack_id=p.id ORDER BY id LIMIT 1) AS cover_file
     FROM packs p LEFT JOIN stickers s ON s.pack_id=p.id
     WHERE p.published=1 AND (? IS NULL OR p.kind=?) GROUP BY p.id ORDER BY p.id DESC`).all(kind, kind);
  res.locals.count = rows.length;
  res.json(rows.map((p) => ({ id: p.id, type: p.kind, name: p.name, author: p.author, count: p.count, cover: p.cover_file ? mediaUrl(p.cover_file, p.kind) : null })));
};

const tagsHandler = (fixed) => (req, res) => {
  const { ok, kind } = resolveKind(fixed, req, res);
  if (!ok) return;
  const counts = {};
  publishedItems(kind).forEach((s) => s._tags.forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
  res.locals.count = Object.keys(counts).length;
  res.json(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count })));
};

const popularHandler = (fixed) => (req, res) => {
  const { ok, kind } = resolveKind(fixed, req, res);
  if (!ok) return;
  const limit = Math.min(Math.max(Math.floor(+req.query.limit) || 12, 1), 50);
  const uid = userIdOf(req);
  // With a user id: only what THIS user used (most used first, then most recent). Without: global popular.
  const rows = uid
    ? db.prepare(
      `SELECT s.*, p.name AS pack_name, p.kind AS kind, u.use_count AS uses FROM user_uses u
       JOIN stickers s ON s.id=u.item_id JOIN packs p ON p.id=s.pack_id
       WHERE u.user_id=? AND p.published=1 AND (? IS NULL OR p.kind=?) AND u.use_count>0
       ORDER BY u.use_count DESC, u.last_used_at DESC, s.id DESC LIMIT ?`).all(uid, kind, kind, limit)
    : db.prepare(
      `SELECT s.*, p.name AS pack_name, p.kind AS kind, s.use_count AS uses FROM stickers s JOIN packs p ON p.id=s.pack_id
       WHERE p.published=1 AND (? IS NULL OR p.kind=?) AND s.use_count>0
       ORDER BY s.use_count DESC, s.last_used_at DESC, s.id DESC LIMIT ?`).all(kind, kind, limit);
  res.locals.count = rows.length;
  res.json({ total: rows.length, limit, scope: uid ? 'user' : 'global', data: rows.map((s) => ({ ...shape(s, 'popular'), uses: s.uses })) });
};

const useHandler = (fixed) => (req, res) => {
  const { ok, kind } = resolveKind(fixed, req, res);
  if (!ok) return;
  // Reports come from your chat server (X-Usage-Key) or from an app holding a token the server signed for that user
  if (USAGE_KEY && !hasUsageKey(req) && !userIdOf(req)) return res.status(401).json({ error: 'Invalid usage key or user token' });
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const r = db.prepare(
    `UPDATE stickers SET use_count=COALESCE(use_count,0)+1, last_used_at=CURRENT_TIMESTAMP
     WHERE id=? AND pack_id IN (SELECT id FROM packs WHERE published=1 AND (? IS NULL OR kind=?))`).run(req.params.id, kind, kind);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  const uid = userIdOf(req);
  if (uid) {
    db.prepare(
      `INSERT INTO user_uses (user_id, item_id, use_count, last_used_at) VALUES (?,?,1,CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, item_id) DO UPDATE SET use_count=use_count+1, last_used_at=CURRENT_TIMESTAMP`).run(uid, req.params.id);
  }
  res.locals.count = 1;
  res.locals.used = { id: Number(req.params.id), kind: db.prepare('SELECT p.kind FROM stickers s JOIN packs p ON p.id=s.pack_id WHERE s.id=?').get(req.params.id).kind }; // for the "Most used" analytics
  res.json({ ok: true });
};

module.exports = { listHandler, packsHandler, tagsHandler, popularHandler, useHandler };