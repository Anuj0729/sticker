const crypto = require('crypto');
const { USAGE_KEY } = require('../config/env');

// Usage reports sent by your chat server carry the shared USAGE_KEY. Without that key
// anybody could inflate the counters, and every report would share one IP's rate limit.
const sha = (v) => crypto.createHash('sha256').update(String(v || '')).digest();
const hasUsageKey = (req) => !!USAGE_KEY && crypto.timingSafeEqual(sha(req.headers['x-usage-key']), sha(USAGE_KEY));

// ---- Signed user tokens ----------------------------------------------------------------------------------
// Personal data ("my most used stickers") must never be chosen by the caller: an app could otherwise send any
// user id and read another person's history. So a user id is only trusted when it comes from
//   (a) your chat SERVER (it sends X-Usage-Key + X-User-Id), or
//   (b) a token your chat server signed for that user (the app sends it as X-User-Token).
// Token format:  <userId>~<expiryUnixSeconds>~<signature>
// signature   =  base64url( HMAC-SHA256( key = "user-token:" + USAGE_KEY, data = "<userId>~<expiry>" ) )
const sign = (payload) => crypto.createHmac('sha256', `user-token:${USAGE_KEY}`).update(payload).digest('base64url');

const signUserToken = (userId, ttlSeconds = 30 * 86400) => {
  const p = `${userId}~${Math.floor(Date.now() / 1000) + ttlSeconds}`;
  return `${p}~${sign(p)}`;
};

// Returns the user id the token was signed for, or '' when the token is missing, forged or expired.
const verifyUserToken = (token) => {
  if (!USAGE_KEY) return '';
  const parts = String(token || '').split('~');
  if (parts.length !== 3) return '';
  const [id, exp, sig] = parts;
  if (!id || !/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return '';
  const a = Buffer.from(sig), b = Buffer.from(sign(`${id}~${exp}`));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? id : '';
};

module.exports = { hasUsageKey, signUserToken, verifyUserToken };
