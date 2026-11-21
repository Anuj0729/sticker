const { DatabaseSync } = require('node:sqlite'); // built into Node 22.13+, no compiling needed
const path = require('path');
const { DB_PATH } = require('./env');

// ---------- DB ----------
// One table of packs and one of items. packs.kind = 'sticker' | 'gif' decides which API serves them.
const db = new DatabaseSync(DB_PATH || path.join(__dirname, '..', '..', 'stickers.db'));
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA journal_mode = WAL');   // readers don't block the writer: far fewer "database is locked" errors
db.exec('PRAGMA busy_timeout = 5000');  // wait up to 5 s for a lock instead of failing at once
db.exec('PRAGMA synchronous = NORMAL'); // safe with WAL, much faster per-request log writes
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
db.exec('CREATE INDEX IF NOT EXISTS idx_stickers_pack ON stickers(pack_id)');

// Per-user usage (like Gboard's "frequently used"): one row per user + sticker/GIF
db.exec(`
CREATE TABLE IF NOT EXISTS user_uses (
  user_id TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES stickers(id) ON DELETE CASCADE,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  PRIMARY KEY (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_user_uses_user ON user_uses(user_id, use_count DESC);`);
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

module.exports = db;
