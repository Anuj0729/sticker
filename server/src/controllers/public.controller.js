const db = require('../config/db');
const { USAGE_KEY } = require('../config/env');
const { sticker, mediaUrl, norm } = require('../utils/media');
const { hasUsageKey, verifyUserToken } = require('../utils/usageKey');
const { publishedItems } = require('../utils/catalog'); // cached in memory, reloaded when the admin changes something

// ---- Tunables (all optional, set in .env) ---------------------------------------------------------------
// GLOBAL_MIN_USERS   : "global popular" is shown only once at least this many different users have reported usage.
//                      Below that, global counts would basically expose 1-2 people's history. 0 = always allow.
// POPULAR_DISCOVER_SLOTS : how many slots of /popular are given to the newest items nobody has used yet, so new
//                      uploads get a chance and the same top items don't stay on top forever. 0 = off.
// USE_COOLDOWN_MS    : the same user (or IP) reporting the same item again within this time is not counted twice.
const intEnv = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; };
const GLOBAL_MIN_USERS = intEnv(process.env.GLOBAL_MIN_USERS, 3);
const DISCOVER_SLOTS = intEnv(process.env.POPULAR_DISCOVER_SLOTS, 2);
const USE_COOLDOWN_MS = intEnv(process.env.USE_COOLDOWN_MS, 1500);

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

// Privacy gate for global popularity: with only 1-2 identified users, "global popular" is really their personal history.
// If usage is reported without user ids at all (0 identified users) there is nothing personal in it, so it is allowed.
const globalAllowed = () => {
  if (!GLOBAL_MIN_USERS) return true;
  const n = db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM user_uses').get().n;
  return n === 0 || n >= GLOBAL_MIN_USERS;
};

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

  // "popular" inside a list/search result:
  //   1) with a verified user: THIS user's most used items first (source: 'user', with their own `uses`)
  //   2) then, if there is room, the globally most used ones (source: 'global', no `uses`, so counts of other people are not exposed)
  //   Without a user: global counts only (source: 'global', with `uses`, as before). Counts are read fresh, not from the cache.
  const uid = userIdOf(req);
  const mine = uid ? userUsesMap(uid) : new Map();
  const glob = globalAllowed() ? globalUsesMap() : new Map();
  const cand = data.filter((d) => d.match !== 'related');
  const own = uid ? cand.filter((d) => (mine.get(d.s.id) || 0) > 0).sort((a, b) => mine.get(b.s.id) - mine.get(a.s.id)) : [];
  const ownIds = new Set(own.map((d) => d.s.id));
  const fallback = cand.filter((d) => !ownIds.has(d.s.id) && (glob.get(d.s.id) || 0) > 0).sort((a, b) => glob.get(b.s.id) - glob.get(a.s.id));
  const popularAll = [
    ...own.map((d) => ({ d, source: 'user', uses: mine.get(d.s.id) })),
    ...fallback.map((d) => ({ d, source: 'global', uses: uid ? undefined : glob.get(d.s.id) })),
  ].slice(0, pl);
  const popIds = new Set(popularAll.map((p) => p.d.s.id));
  const recentAll = data.filter((d) => !popIds.has(d.s.id));
  const out = (d) => shape(d.s, d.match);

  res.json({
    total: data.length, matched, limit, offset,
    ...(offset === 0 && popularAll.length > 0 && {
      popular: popularAll.map((p) => ({ ...out(p.d), source: p.source, ...(p.uses !== undefined && { uses: p.uses }) })),
    }),
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

// GET /api/media/:id   (numeric id; ?type=sticker|gif optional)  -> one published item, same shape as in the lists.
// Lets a chat server look the item up itself (so it never has to trust a URL sent by an app).
const itemHandler = (fixed) => (req, res) => {
  const { ok, kind } = resolveKind(fixed, req, res);
  if (!ok) return;
  const id = Number(req.params.id);
  const s = publishedItems(kind).find((x) => x.id === id);
  res.locals.count = s ? 1 : 0;
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json(shape(s, 'item'));
};

// Builds the popular list for a user (or anonymous). Used by /popular and, optionally, by /use.
// Each item has `source`: 'user' (your own most used, with `uses`) | 'global' (everyone's most used) | 'new' (discover slot).
// `scope`: 'user' | 'global' | 'user+global'  (describes the popular items only; 'new' items are not counted).
const discoverParam = (req) => (req.query.discover === undefined || req.query.discover === ''
  ? DISCOVER_SLOTS : Math.min(Math.max(Math.floor(+req.query.discover) || 0, 0), 5));

const buildPopular = (kind, uid, limit, wantDiscover) => {
  const discover = Math.min(wantDiscover, limit - 1);   // never let discover slots take over the whole list
  const target = limit - discover;                       // slots left for real popular items

  // 1) this user's own most used (most used first, then most recent)
  const userRows = uid
    ? db.prepare(
      `SELECT s.*, p.name AS pack_name, p.kind AS kind, u.use_count AS uses FROM user_uses u
       JOIN stickers s ON s.id=u.item_id JOIN packs p ON p.id=s.pack_id
       WHERE u.user_id=? AND p.published=1 AND (? IS NULL OR p.kind=?) AND u.use_count>0
       ORDER BY u.use_count DESC, u.last_used_at DESC, s.id DESC LIMIT ?`).all(uid, kind, kind, target)
    : [];
  let items = userRows.map((r) => ({ ...shape(r, 'popular'), source: 'user', uses: r.uses }));

  // 2) fill the rest with global popular (no duplicates; ask for extra rows because some will be duplicates)
  if (items.length < target && globalAllowed()) {
    const have = new Set(items.map((i) => i.id));
    const globalRows = db.prepare(
      `SELECT s.*, p.name AS pack_name, p.kind AS kind, s.use_count AS uses FROM stickers s JOIN packs p ON p.id=s.pack_id
       WHERE p.published=1 AND (? IS NULL OR p.kind=?) AND s.use_count>0
       ORDER BY s.use_count DESC, s.last_used_at DESC, s.id DESC LIMIT ?`).all(kind, kind, target + items.length);
    const extra = globalRows.filter((r) => !have.has(r.id)).slice(0, target - items.length);
    // a logged-in user must not see other people's counts, only the ranking
    items = items.concat(extra.map((r) => ({ ...shape(r, 'popular'), source: 'global', ...(!uid && { uses: r.uses }) })));
  }

  const popularCount = items.length;
  const fromUser = items.some((i) => i.source === 'user');
  const fromGlobal = items.some((i) => i.source === 'global');
  const scope = fromUser && fromGlobal ? 'user+global' : fromGlobal ? 'global' : fromUser ? 'user' : (uid ? 'user' : 'global');

  // 3) discover slots: newest published items that are not already in the list
  if (discover > 0) {
    const have = new Set(items.map((i) => i.id));
    publishedItems(kind).filter((s) => !have.has(s.id)).slice(0, discover)
      .forEach((s) => items.push({ ...shape(s, 'new'), source: 'new' }));
  }
  return { items, popularCount, scope };
};

// GET /api/media/popular   (also /api/stickers/popular, /api/gifs/popular)
//   ?limit=12 (1-50)   ?discover=2 (0-5: slots for the newest never-used items; default POPULAR_DISCOVER_SLOTS)
const popularHandler = (fixed) => (req, res) => {
  const { ok, kind } = resolveKind(fixed, req, res);
  if (!ok) return;
  const limit = Math.min(Math.max(Math.floor(+req.query.limit) || 12, 1), 50);
  const { items, popularCount, scope } = buildPopular(kind, userIdOf(req), limit, discoverParam(req));
  res.locals.count = items.length;
  res.json({ total: items.length, popularTotal: popularCount, limit, scope, data: items });
};

// Remembers when an item was last counted for a user/IP, so a double tap or a looping client can't inflate counts.
const lastCounted = new Map(); // `${uidOrIp}:${itemId}` -> timestamp
setInterval(() => {
  const cutoff = Date.now() - Math.max(USE_COOLDOWN_MS, 1000) * 2;
  for (const [k, t] of lastCounted) if (t < cutoff) lastCounted.delete(k);
}, 60000).unref();

// POST /api/media/:id/use     Call this every time a user SENDS a sticker/GIF (this is what feeds "popular").
//   Optional: add ?popular_limit=10 (1-50, and ?discover=0-5 like /popular) and the response also carries the
//   user's UPDATED popular list ({ popular, scope }), so the app does not need a second request. Off by default.
const useHandler = (fixed) => (req, res) => {
  const { ok, kind } = resolveKind(fixed, req, res);
  if (!ok) return;
  // Reports come from your chat server (X-Usage-Key) or from an app holding a token the server signed for that user
  if (USAGE_KEY && !hasUsageKey(req) && !userIdOf(req)) return res.status(401).json({ error: 'Invalid usage key or user token' });
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const uid = userIdOf(req);

  const itemId = Number(req.params.id);
  const popLimit = Math.min(Math.max(Math.floor(+req.query.popular_limit) || 0, 0), 50);
  const withPopular = () => {
    if (!popLimit) return {};
    const { items, scope } = buildPopular(kind, uid, popLimit, discoverParam(req));
    return { scope, popular: items };
  };
  const who = uid || `ip:${req.ip}`;
  const key = `${who}:${itemId}`;
  const now = Date.now();
  if (USE_COOLDOWN_MS && now - (lastCounted.get(key) || 0) < USE_COOLDOWN_MS) {
    res.locals.count = 0;
    return res.json({ ok: true, counted: false, ...withPopular() }); // duplicate within the cooldown: accepted, but not counted again
  }

  // Global counter + per-user counter change together or not at all
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = db.prepare(
      `UPDATE stickers SET use_count=COALESCE(use_count,0)+1, last_used_at=CURRENT_TIMESTAMP
       WHERE id=? AND pack_id IN (SELECT id FROM packs WHERE published=1 AND (? IS NULL OR kind=?))`).run(itemId, kind, kind);
    if (!r.changes) { db.exec('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    if (uid) {
      db.prepare(
        `INSERT INTO user_uses (user_id, item_id, use_count, last_used_at) VALUES (?,?,1,CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, item_id) DO UPDATE SET use_count=use_count+1, last_used_at=CURRENT_TIMESTAMP`).run(uid, itemId);
    }
    const usedKind = db.prepare('SELECT p.kind FROM stickers s JOIN packs p ON p.id=s.pack_id WHERE s.id=?').get(itemId).kind;
    db.exec('COMMIT');
    lastCounted.set(key, now);
    res.locals.count = 1;
    res.locals.used = { id: itemId, kind: usedKind }; // for the "Most used" analytics
    res.json({ ok: true, counted: true, ...withPopular() }); // popular is read AFTER the commit, so it already includes this use
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* no open transaction */ }
    throw e;
  }
};

module.exports = { listHandler, packsHandler, tagsHandler, popularHandler, useHandler, itemHandler };