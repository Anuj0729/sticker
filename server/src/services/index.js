const db = require('../config/db');
const { JWT_SECRET, LOG_RETENTION_DAYS, REQUIRE_API_KEY } = require('../config/env');
const analyticsModule = require('../modules/analytics');
const keysModule = require('../modules/apiKeys');
const { mediaUrl } = require('../utils/media');

// API hit tracking (who calls the sticker/GIF API, from where, on which platform) for the admin Analytics tab
// (itemUrl: lets the "Most used" list show a thumbnail of each sticker / GIF)
const analytics = analyticsModule.init(db, { secret: JWT_SECRET, retentionDays: +LOG_RETENTION_DAYS || 0, itemUrl: (file, kind) => mediaUrl(file, kind) });

// API keys. The admin turns "Require API key" on/off in the admin panel (API keys tab).
// REQUIRE_API_KEY in .env is only the starting value on the very first run; after that the admin switch decides.
const apiKeys = keysModule.init(db, { defaultRequired: !['0', 'false'].includes(REQUIRE_API_KEY) });

module.exports = { analytics, apiKeys };
