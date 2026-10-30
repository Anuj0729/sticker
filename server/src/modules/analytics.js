// API hit tracking for the admin dashboard.
//
//  - logMiddleware   : records every /api request (who called, from which platform, which endpoint, how many results,
//                      success or failed) and, for successful calls, WHAT was searched (tag / pack) and WHICH item was used
//  - adminRoutes     : /admin/analytics (dashboard data) and /admin/analytics/export (.xlsx or .csv)
//
// WHERE a call comes from ("source") and WHICH PLATFORM it runs on are told by the caller:
//     X-Source: chat-keyboard        (or ?source=chat-keyboard)   -> app / screen / website name
//     X-Platform: android|ios|web    (or ?platform=android)
// If they are missing we fall back to the Origin/Referer host (source) and the User-Agent (platform).
const crypto = require('crypto');

const TESTER_SOURCE = 'admin-tester'; // the /tester page in the admin sends this, so it can be hidden from real traffic
const PLATFORMS = ['android', 'ios', 'web', 'server', 'other'];
const TYPES = ['sticker', 'gif', 'all'];

const label = (v, max = 60) => String(v || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._:/@-]/g, '').slice(0, max);

const hostOf = (u) => { try { return new URL(u).host.toLowerCase(); } catch { return ''; } };

const platformFromUA = (ua) => {
  if (/okhttp|android|dalvik/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod|cfnetwork|darwin|\bios\b/i.test(ua)) return 'ios';
  if (/curl|postman|insomnia|axios|node-fetch|undici|python|go-http|java\/|got \(|httpie/i.test(ua)) return 'server';
  if (/mozilla|chrome|safari|firefox|edg\//i.test(ua)) return 'web';
  return 'other';
};

const pad = (n) => String(n).padStart(2, '0');
const sqlTime = (d = new Date()) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

function init(db, { secret = '', retentionDays = 0, itemUrl = (file) => file } = {}) {
  db.exec(`
CREATE TABLE IF NOT EXISTS api_logs (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,                 -- UTC, 'YYYY-MM-DD HH:MM:SS'
  endpoint TEXT NOT NULL,           -- route, e.g. /api/media
  method TEXT NOT NULL,
  type TEXT NOT NULL,               -- sticker | gif | all
  source TEXT NOT NULL,             -- where the call comes from
  platform TEXT NOT NULL,           -- android | ios | web | server | other
  status INTEGER,
  result_count INTEGER,
  ms INTEGER,
  client TEXT,                      -- short hash of the caller's IP (never the IP itself)
  params TEXT,                      -- filters used: pack=..&tag=..
  ua TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_logs_ts ON api_logs(ts);
CREATE INDEX IF NOT EXISTS idx_api_logs_source ON api_logs(source, ts);

-- one row per searched term (a tag or a pack name) - powers "Search demand"
CREATE TABLE IF NOT EXISTS api_searches (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,               -- tag | pack
  term TEXT NOT NULL,               -- what the caller searched for, lower-case
  type TEXT NOT NULL,               -- sticker | gif | all (the API type that was searched)
  results INTEGER NOT NULL,         -- how many items matched this term (0 = demand we could not serve)
  source TEXT NOT NULL,
  platform TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_searches_ts ON api_searches(ts);
CREATE INDEX IF NOT EXISTS idx_api_searches_term ON api_searches(kind, term);

-- one row every time an item is reported as used (POST .../:id/use) - powers "Most used"
CREATE TABLE IF NOT EXISTS item_uses (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  type TEXT NOT NULL,               -- sticker | gif
  source TEXT NOT NULL,
  platform TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_item_uses_ts ON item_uses(ts);
CREATE INDEX IF NOT EXISTS idx_item_uses_item ON item_uses(item_id);`);

  if (!db.prepare('PRAGMA table_info(api_logs)').all().some((c) => c.name === 'key_name')) db.exec('ALTER TABLE api_logs ADD COLUMN key_name TEXT');

  const insert = db.prepare(
    `INSERT INTO api_logs (ts,endpoint,method,type,source,platform,status,result_count,ms,client,params,ua,key_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertSearch = db.prepare('INSERT INTO api_searches (ts,kind,term,type,results,source,platform) VALUES (?,?,?,?,?,?,?)');
  const insertUse = db.prepare('INSERT INTO item_uses (ts,item_id,type,source,platform) VALUES (?,?,?,?,?)');

  // ---------- logging ----------
  const logMiddleware = (req, res, next) => {
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      try {
        const q = req.query || {};
        const ua = String(req.headers['user-agent'] || '');
        const origin = hostOf(req.headers.origin) || hostOf(req.headers.referer);
        const source = label(req.headers['x-source'] || q.source) || label(res.locals.keyName) || label(origin) || 'unknown'; // the API key's name is the fallback source
        const claimed = label(req.headers['x-platform'] || q.platform, 20);
        const platform = PLATFORMS.includes(claimed) ? claimed : claimed === 'desktop' ? 'web' : platformFromUA(ua);
        const endpoint = req.route ? req.baseUrl + req.route.path : 'unmatched';
        const params = Object.entries(q)
          .filter(([k]) => ['pack', 'tag', 'q', 'type', 'limit', 'offset', 'related'].includes(k))
          .map(([k, v]) => `${k}=${String(v).slice(0, 60)}`).join('&').slice(0, 200);
        const client = crypto.createHash('sha256').update(`${req.ip}|${secret}`).digest('hex').slice(0, 12);
        const ts = sqlTime();
        const type = TYPES.includes(res.locals.kind) ? res.locals.kind : 'all';
        insert.run(
          ts, endpoint, req.method, type,
          source, platform, res.statusCode, res.locals.count ?? null,
          Number((process.hrtime.bigint() - t0) / 1000000n), client, params, ua.slice(0, 160), res.locals.keyName || null);

        if (res.statusCode < 400) {
          // what was searched (the handler fills res.locals.search: [{ kind: 'tag'|'pack', term, results }])
          for (const x of res.locals.search || []) insertSearch.run(ts, x.kind, x.term, type, x.results, source, platform);
          // which item was used
          if (res.locals.used) insertUse.run(ts, res.locals.used.id, res.locals.used.kind, source, platform);
        }
      } catch (e) { console.error('api log failed:', e.message); } // tracking must never break the API
    });
    next();
  };

  if (retentionDays > 0) {
    const prune = () => {
      const age = `-${Math.floor(retentionDays)} days`;
      for (const t of ['api_logs', 'api_searches', 'item_uses']) db.prepare(`DELETE FROM ${t} WHERE ts < datetime('now', ?)`).run(age);
    };
    prune();
    setInterval(() => { try { prune(); } catch {} }, 3600 * 1000).unref();
  }

  // ---------- querying ----------
  const SQLTIME = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/;
  const parse = (q) => {
    const tz = Number.isFinite(+q.tz) && Math.abs(+q.tz) <= 840 ? Math.trunc(+q.tz) : 0; // minutes east of UTC (IST = 330)
    return {
      tz, tzMod: `${tz >= 0 ? '+' : '-'}${Math.abs(tz)} minutes`,
      from: SQLTIME.test(q.from || '') ? q.from : '',
      to: SQLTIME.test(q.to || '') ? q.to : '',
      type: TYPES.includes(q.type) && q.type !== 'all' ? q.type : '',
      source: label(q.source),
      platform: PLATFORMS.includes(q.platform) ? q.platform : '',
      hideTester: q.hideTester === '1',
    };
  };

  const where = (f) => {
    const w = [], a = [];
    if (f.from) { w.push('ts >= ?'); a.push(f.from); }
    if (f.to) { w.push('ts < ?'); a.push(f.to); }
    if (f.type) { w.push('type = ?'); a.push(f.type); }
    if (f.source) { w.push('source = ?'); a.push(f.source); }
    if (f.platform) { w.push('platform = ?'); a.push(f.platform); }
    if (f.hideTester) { w.push('source <> ?'); a.push(TESTER_SOURCE); }
    return { sql: w.length ? `WHERE ${w.join(' AND ')}` : '', args: a };
  };

  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const iso = (s) => new Date(s.replace(' ', 'T').slice(0, 16) + 'Z'); // 'local' wall-clock text treated as UTC just for stepping through buckets

  // "WHERE a AND b" helper: adds one more condition to the clause where() built
  const andWhere = (W, cond) => `${W ? `${W} AND` : 'WHERE'} ${cond}`;

  // ---- (a) per-day success vs failed ----
  // success = HTTP < 400. failed = 4xx/5xx, split into: blocked (no/wrong/disabled key), rate-limited (429), other errors.
  function dailyOutcome(f, W, A) {
    const rows = all(
      `SELECT strftime('%Y-%m-%d', ts, ?) d, COUNT(*) hits,
              SUM(status < 400) success,
              SUM(status IN (401,403)) blocked,
              SUM(status = 429) limited,
              SUM(status >= 400 AND status NOT IN (401,403,429)) errors
       FROM api_logs ${W} GROUP BY d ORDER BY d`, f.tzMod, ...A);
    const have = new Map(rows.map((r) => [r.d, r]));
    const dayOf = (d) => new Date(`${d}T00:00:00Z`).getTime();
    const bucketOf = (s) => one('SELECT strftime(?, ?, ?) b', '%Y-%m-%d', s, f.tzMod).b;
    const today = one(`SELECT strftime('%Y-%m-%d', 'now', ?) b`, f.tzMod).b;
    if (!rows.length && !f.from) return [];
    const start = f.from ? bucketOf(f.from) : rows[0].d;
    const end = f.to ? bucketOf(sqlTime(new Date(iso(f.to).getTime() - 60000))) : today;
    const stop = Math.max(dayOf(end), rows.length ? dayOf(rows[rows.length - 1].d) : 0);
    const out = [];
    for (let t = dayOf(start), i = 0; t <= stop && i < 400; t += 86400000, i++) {
      const day = new Date(t).toISOString().slice(0, 10);
      const r = have.get(day);
      const hits = r?.hits || 0, success = r?.success || 0;
      out.push({
        day, hits, success, failed: hits - success,
        blocked: r?.blocked || 0, limited: r?.limited || 0, errors: r?.errors || 0,
        successRate: hits ? success / hits : null, // null = no calls that day
      });
    }
    return out.slice(-400);
  }

  // ---- (b) search demand: which tags / packs people search for ----
  function searchDemand(f, W, A) {
    const total = (kind) => one(`SELECT COUNT(*) n, SUM(results = 0) none FROM api_searches ${andWhere(W, 'kind = ?')}`, ...A, kind);
    const top = (kind) => {
      const t = total(kind);
      return all(
        `SELECT term, COUNT(*) searches, SUM(type='sticker') sticker, SUM(type='gif') gif, SUM(type='all') unified,
                SUM(results = 0) no_result, ROUND(AVG(results)) avg_results, datetime(MAX(ts), ?) last_search
         FROM api_searches ${andWhere(W, 'kind = ?')} GROUP BY term ORDER BY searches DESC, term LIMIT 50`, f.tzMod, ...A, kind)
        .map((r, i) => ({ ...r, rank: i + 1, share: t.n ? r.searches / t.n : 0 }));
    };
    const tags = top('tag'), packs = top('pack');
    const tt = total('tag'), tp = total('pack');
    return {
      tags, packs,
      totals: { tagSearches: tt.n, packSearches: tp.n, noResult: (tt.none || 0) + (tp.none || 0) },
    };
  }

  // ---- (c) most used sticker / GIF ----
  // All time (no period / source / platform filter): the item's own counter, which also holds uses from before logging existed.
  // Any other filter: counted from the usage log.
  function mostUsed(f, W, A) {
    const counter = !f.from && !f.to && !f.source && !f.platform;
    const top = (kind) => {
      if (f.type && f.type !== kind) return [];
      const rows = counter
        ? all(`SELECT s.id, s.tags, s.file, s.use_count uses, datetime(s.last_used_at, ?) last_used, p.name pack_name, p.kind
               FROM stickers s JOIN packs p ON p.id = s.pack_id
               WHERE s.use_count > 0 AND p.kind = ? ORDER BY s.use_count DESC, s.last_used_at DESC, s.id DESC LIMIT 10`, f.tzMod, kind)
        : all(`SELECT s.id, s.tags, s.file, COUNT(*) uses, datetime(MAX(ts), ?) last_used, p.name pack_name, p.kind
               FROM item_uses JOIN stickers s ON s.id = item_uses.item_id JOIN packs p ON p.id = s.pack_id
               ${andWhere(W, 'p.kind = ?')} GROUP BY s.id ORDER BY uses DESC, MAX(ts) DESC, s.id DESC LIMIT 10`, f.tzMod, ...A, kind);
      return rows;
    };
    const totalOf = (kind) => (counter
      ? one('SELECT COALESCE(SUM(s.use_count),0) n FROM stickers s JOIN packs p ON p.id = s.pack_id WHERE p.kind = ?', kind).n
      : one(`SELECT COUNT(*) n FROM item_uses ${andWhere(W, 'item_uses.type = ?')}`, ...A, kind).n);
    const shape = (kind) => {
      const total = f.type && f.type !== kind ? 0 : totalOf(kind);
      return {
        total,
        items: top(kind).map((r, i) => ({
          rank: i + 1, id: r.id, type: kind, url: itemUrl(r.file, kind), pack: r.pack_name,
          tags: r.tags ? r.tags.split(',') : [], uses: r.uses, share: total ? r.uses / total : 0, lastUsed: r.last_used,
        })),
      };
    };
    return { basis: counter ? 'counter' : 'log', sticker: shape('sticker'), gif: shape('gif') };
  }

  function analytics(query, { recentLimit = 50 } = {}) {
    const f = parse(query);
    const { sql: W, args: A } = where(f);

    const t = one(
      `SELECT COUNT(*) hits, COUNT(DISTINCT source) sources, COUNT(DISTINCT client) clients,
              SUM(status >= 400) errors, ROUND(AVG(ms),1) avg_ms, MIN(ts) first_hit, MAX(ts) last_hit FROM api_logs ${W}`, ...A);

    const sources = all(
      `SELECT source, COUNT(*) hits, SUM(type='sticker') sticker, SUM(type='gif') gif, SUM(type='all') unified,
              COUNT(DISTINCT client) clients, SUM(status >= 400) errors,
              datetime(MIN(ts), ?) first_hit, datetime(MAX(ts), ?) last_hit
       FROM api_logs ${W} GROUP BY source ORDER BY hits DESC, source LIMIT 500`, f.tzMod, f.tzMod, ...A);

    const matrix = all(`SELECT source, platform, COUNT(*) hits FROM api_logs ${W} GROUP BY source, platform ORDER BY hits DESC`, ...A);
    const bySource = {};
    matrix.forEach((m) => { (bySource[m.source] ||= {})[m.platform] = m.hits; });
    sources.forEach((s, i) => { s.rank = i + 1; s.share = t.hits ? s.hits / t.hits : 0; s.platforms = bySource[s.source] || {}; });

    const platforms = all(`SELECT platform, COUNT(*) hits, COUNT(DISTINCT source) sources FROM api_logs ${W} GROUP BY platform ORDER BY hits DESC`, ...A);
    const endpoints = all(
      `SELECT endpoint, COUNT(*) hits, SUM(status >= 400) errors, ROUND(AVG(ms),1) avg_ms FROM api_logs ${W} GROUP BY endpoint ORDER BY hits DESC`, ...A);
    const types = all(`SELECT type, COUNT(*) hits FROM api_logs ${W} GROUP BY type`, ...A);
    // response outcome (donut) and busiest hours of the day in the admin's time zone (bar chart)
    const statuses = all(
      `SELECT CASE WHEN status = 429 THEN 'rate-limited' WHEN status IN (401,403) THEN 'blocked (key)'
                   WHEN status >= 500 THEN 'server error' WHEN status >= 400 THEN 'client error' ELSE 'success' END grp, COUNT(*) hits
       FROM api_logs ${W} GROUP BY grp ORDER BY hits DESC`, ...A);
    const hourMap = new Map(all(`SELECT CAST(strftime('%H', ts, ?) AS INTEGER) h, COUNT(*) hits FROM api_logs ${W} GROUP BY h`, f.tzMod, ...A).map((r) => [r.h, r.hits]));
    const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, hits: hourMap.get(h) || 0 }));

    // timeline: hourly for ranges up to 2 days, daily otherwise; gaps are filled with zeros
    const spanH = f.from && f.to ? (iso(f.to) - iso(f.from)) / 3600000 : Infinity;
    const hourly = spanH <= 48;
    const fmt = hourly ? '%Y-%m-%d %H:00' : '%Y-%m-%d';
    const rows = all(
      `SELECT strftime(?, ts, ?) b, COUNT(*) hits, SUM(type='sticker') sticker, SUM(type='gif') gif, SUM(type='all') unified
       FROM api_logs ${W} GROUP BY b ORDER BY b`, fmt, f.tzMod, ...A);
    const have = new Map(rows.map((r) => [r.b, r]));
    let points = [];
    if (rows.length || (f.from && f.to)) {
      const bucketOf = (s) => one('SELECT strftime(?, ?, ?) b', fmt, s, f.tzMod).b;
      const start = f.from ? bucketOf(f.from) : rows[0].b;
      const endB = f.to ? bucketOf(sqlTime(new Date(iso(f.to).getTime() - 60000))) : rows[rows.length - 1].b;
      const step = hourly ? 3600000 : 86400000;
      const stop = Math.max(iso(endB).getTime(), iso(rows.length ? rows[rows.length - 1].b : start).getTime());
      for (let d = iso(start).getTime(), n = 0; d <= stop && n < 400; d += step, n++) {
        const key = new Date(d).toISOString().slice(0, hourly ? 13 : 10).replace('T', ' ') + (hourly ? ':00' : '');
        const r = have.get(key);
        points.push({ t: key, hits: r?.hits || 0, sticker: r?.sticker || 0, gif: r?.gif || 0, unified: r?.unified || 0 });
      }
      if (points.length >= 400) points = points.slice(-400);
    }

    const recent = all(
      `SELECT datetime(ts, ?) time, source, key_name, platform, endpoint, method, type, params, status, result_count, ms
       FROM api_logs ${W} ORDER BY id DESC LIMIT ?`, f.tzMod, ...A, recentLimit);

    return {
      filters: f,
      totals: {
        hits: t.hits, sources: t.sources, clients: t.clients, errors: t.errors || 0, avgMs: t.avg_ms || 0,
        successRate: t.hits ? (t.hits - (t.errors || 0)) / t.hits : null,
        firstHit: t.first_hit, lastHit: t.last_hit,
      },
      topSource: sources[0] ? { source: sources[0].source, hits: sources[0].hits, share: sources[0].share } : null,
      sources, platforms, matrix, endpoints, types, statuses, byHour,
      timeline: { bucket: hourly ? 'hour' : 'day', points },
      daily: dailyOutcome(f, W, A),
      searchDemand: searchDemand(f, W, A),
      mostUsed: mostUsed(f, W, A),
      recent,
    };
  }


  // ---------- admin routes ----------
  function adminRoutes(app, adminOnly) {
    app.get('/admin/analytics', adminOnly, (req, res) => res.json(analytics(req.query)));

    // Everything as a spreadsheet: .xlsx (opens in Excel and Google Sheets) or .csv (raw hits only)
    app.get('/admin/analytics/export', adminOnly, async (req, res, next) => {
      try {
        const f = parse(req.query);
        const { sql: W, args: A } = where(f);
        const stamp = new Date().toISOString().slice(0, 10);
        const RAW_LIMIT = 200000;
        const raw = db.prepare(
          `SELECT datetime(ts, ?) time, source, key_name, platform, endpoint, method, type, params, status, result_count, ms, client, ua
           FROM api_logs ${W} ORDER BY id DESC LIMIT ${RAW_LIMIT}`).all(f.tzMod, ...A);

        if (req.query.format === 'csv') {
          const cols = ['time', 'source', 'key_name', 'platform', 'endpoint', 'method', 'type', 'params', 'status', 'result_count', 'ms', 'client', 'ua'];
          // a leading = + - @ would be run as a formula by Excel/Sheets, so such cells get a ' in front
          const cell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
          const csv = '﻿' + [cols.join(','), ...raw.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
          res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="api-hits-${stamp}.csv"` });
          return res.send(csv);
        }

        const ExcelJS = require('exceljs');
        const a = analytics(req.query, { recentLimit: 0 });
        const wb = new ExcelJS.Workbook();
        wb.creator = 'GaonGram Studio';
        wb.created = new Date();

        const sheet = (name, columns, rows, { fmt = {} } = {}) => {
          const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
          ws.columns = columns.map(([header, key, width]) => ({ header, key, width: width || 14 }));
          rows.forEach((r) => ws.addRow(r));
          const h = ws.getRow(1);
          h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5B3DF5' } };
          Object.entries(fmt).forEach(([k, nf]) => { ws.getColumn(k).numFmt = nf; });
          if (columns.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
          return ws;
        };

        const tzName = `UTC${f.tz >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(f.tz) / 60))}:${pad(Math.abs(f.tz) % 60)}`;
        const summary = sheet('Summary', [['Item', 'k', 34], ['Value', 'v', 48]], [
          { k: 'Exported at', v: `${sqlTime(new Date(Date.now() + f.tz * 60000))} (${tzName})` },
          { k: 'From', v: f.from || 'beginning' },
          { k: 'To', v: f.to || 'now' },
          { k: 'Type filter', v: f.type || 'all' },
          { k: 'Source filter', v: f.source || 'all' },
          { k: 'Platform filter', v: f.platform || 'all' },
          { k: 'Admin tester hidden', v: f.hideTester ? 'yes' : 'no' },
          { k: 'Total API hits', v: a.totals.hits },
          { k: 'Most used source', v: a.topSource ? `${a.topSource.source} (${a.topSource.hits} hits)` : '-' },
          { k: 'Active sources', v: a.totals.sources },
          { k: 'Unique clients (hashed IPs)', v: a.totals.clients },
          { k: 'Errors / failed (HTTP 4xx/5xx)', v: a.totals.errors },
          { k: 'Success rate', v: a.totals.successRate == null ? '-' : `${(a.totals.successRate * 100).toFixed(1)}%` },
          { k: 'Average response time (ms)', v: a.totals.avgMs },
          { k: 'Rows in "All hits" sheet', v: raw.length >= RAW_LIMIT ? `${RAW_LIMIT} (limit reached, newest first)` : raw.length },
          { k: 'Times shown in', v: tzName },
        ]);
        summary.getColumn('k').font = { bold: true };

        sheet('Sources', [
          ['Rank', 'rank', 7], ['Source (where from)', 'source', 32], ['Hits', 'hits', 10], ['Share', 'share', 9],
          ['Sticker hits', 'sticker', 13], ['GIF hits', 'gif', 10], ['Unified (both)', 'unified', 14],
          ...PLATFORMS.map((p) => [p === 'ios' ? 'iOS' : p[0].toUpperCase() + p.slice(1), p, 10]),
          ['Unique clients', 'clients', 14], ['Errors', 'errors', 9], ['First hit', 'first_hit', 20], ['Last hit', 'last_hit', 20],
        ], a.sources.map((s) => ({ ...s, ...Object.fromEntries(PLATFORMS.map((p) => [p, s.platforms[p] || 0])) })), { fmt: { share: '0.0%' } });

        sheet('Platforms', [['Platform', 'platform', 16], ['Hits', 'hits', 10], ['Sources', 'sources', 10]], a.platforms);
        sheet('Source x Platform', [['Source', 'source', 32], ['Platform', 'platform', 14], ['Hits', 'hits', 10]], a.matrix);
        sheet('Endpoints', [['Endpoint', 'endpoint', 34], ['Hits', 'hits', 10], ['Errors', 'errors', 9], ['Avg ms', 'avg_ms', 9]], a.endpoints);
        sheet('Daily success-failed', [
          ['Day', 'day', 14], ['Total hits', 'hits', 12], ['Success', 'success', 10], ['Failed', 'failed', 10], ['Success rate', 'successRate', 13],
          ['Blocked (key)', 'blocked', 14], ['Rate-limited', 'limited', 14], ['Other errors', 'errors', 13],
        ], a.daily, { fmt: { successRate: '0.0%' } });
        sheet('Search demand', [
          ['Searched for', 'kind', 13], ['Term', 'term', 28], ['Searches', 'searches', 10], ['Share', 'share', 9],
          ['Sticker API', 'sticker', 12], ['GIF API', 'gif', 10], ['Both', 'unified', 9], ['No result', 'no_result', 11], ['Avg results', 'avg_results', 12], ['Last searched', 'last_search', 20],
        ], [...a.searchDemand.tags.map((r) => ({ ...r, kind: 'tag' })), ...a.searchDemand.packs.map((r) => ({ ...r, kind: 'pack' }))], { fmt: { share: '0.0%' } });
        sheet('Most used', [
          ['Type', 'type', 10], ['Rank', 'rank', 7], ['Item ID', 'id', 10], ['Pack', 'pack', 24], ['Tags', 'tags', 30], ['Uses', 'uses', 9], ['Share', 'share', 9], ['Last used', 'lastUsed', 20],
        ], [...a.mostUsed.sticker.items, ...a.mostUsed.gif.items].map((r) => ({ ...r, tags: r.tags.join(', ') })), { fmt: { share: '0.0%' } });
        sheet('Timeline', [[a.timeline.bucket === 'hour' ? 'Hour' : 'Day', 't', 18], ['Hits', 'hits', 9], ['Sticker', 'sticker', 9], ['GIF', 'gif', 9], ['Unified', 'unified', 9]], a.timeline.points);
        sheet('All hits', [
          ['Time', 'time', 20], ['Source', 'source', 28], ['API key', 'key_name', 22], ['Platform', 'platform', 11], ['Endpoint', 'endpoint', 28], ['Method', 'method', 8],
          ['Type', 'type', 9], ['Filters used', 'params', 34], ['Status', 'status', 8], ['Results', 'result_count', 9], ['ms', 'ms', 7],
          ['Client', 'client', 14], ['User agent', 'ua', 50],
        ], raw);

        res.set({
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="api-analytics-${stamp}.xlsx"`,
        });
        await wb.xlsx.write(res);
        res.end();
      } catch (e) { next(e); }
    });
  }

  return { logMiddleware, adminRoutes, analytics };
}

module.exports = { init, TESTER_SOURCE };