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
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (v.reset < n) hits.delete(k); }, 60000).unref();

module.exports = { rateLimit };
