// Usage:  node scripts/make-user-token.js <userId> [days]
// Prints a token your chat server can hand to the app. The app sends it as the X-User-Token header.
require('../src/config/env');
const { signUserToken } = require('../src/utils/usageKey');
const [id, days = '30'] = process.argv.slice(2);
if (!id || !/^[A-Za-z0-9._:@-]{1,64}$/.test(id)) { console.error('Usage: node scripts/make-user-token.js <userId> [days]   (userId: letters, numbers . _ : @ -)'); process.exit(1); }
if (!require('../src/config/env').USAGE_KEY) { console.error('Set USAGE_KEY in .env first.'); process.exit(1); }
console.log(signUserToken(id, Math.max(1, +days || 30) * 86400));
