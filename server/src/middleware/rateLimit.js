const { hasUsageKey } = require('../utils/usageKey');

// Tiny in-memory rate limit: 120 requests / minute / IP
const hits = new Map();

const rateLimit = (req, res, next) => {
  if (req.method === 'POST' && hasUsageKey(req)) return next();
  const now = Date.now();
  const h = hits.get(req.ip);
  if (!h || h.reset < now) { hits.set(req.ip, { count: 1, reset: now + 60000 }); return next(); }
  if (++h.count > 120) return res.status(429).json({ error: 'Too many requests, try again in a minute' });
  next();
};

// Admin login guard: 5 wrong passwords per IP, then locked for 15 minutes.
const LOGIN_MAX = 5;
const LOGIN_WINDOW = 15 * 60 * 1000;
const fails = new Map();

const loginGuard = (req, res, next) => {
  const f = fails.get(req.ip);
  const now = Date.now();
  if (f && f.reset > now && f.count >= LOGIN_MAX) {
    res.set('Retry-After', String(Math.ceil((f.reset - now) / 1000)));
    return res.status(429).json({ error: 'Too many wrong passwords. Try again later.' });
  }
  next();
};
const loginFailed = (req) => {
  const now = Date.now();
  const f = fails.get(req.ip);
  if (!f || f.reset < now) fails.set(req.ip, { count: 1, reset: now + LOGIN_WINDOW });
  else f.count++;
};
const loginSucceeded = (req) => fails.delete(req.ip);

setInterval(() => {
  const n = Date.now();
  for (const [k, v] of hits) if (v.reset < n) hits.delete(k);
  for (const [k, v] of fails) if (v.reset < n) fails.delete(k);
}, 60000).unref();

module.exports = { rateLimit, loginGuard, loginFailed, loginSucceeded };
