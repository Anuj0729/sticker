const crypto = require('crypto');
const { USAGE_KEY } = require('../config/env');

// Usage reports sent by your chat server carry the shared USAGE_KEY. Without that key
// anybody could inflate the counters, and every report would share one IP's rate limit.
const sha = (v) => crypto.createHash('sha256').update(String(v || '')).digest();
const hasUsageKey = (req) => !!USAGE_KEY && crypto.timingSafeEqual(sha(req.headers['x-usage-key']), sha(USAGE_KEY));

module.exports = { hasUsageKey };
