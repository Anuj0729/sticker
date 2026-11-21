const express = require('express');
const { analytics, apiKeys } = require('../services');
const { hasUsageKey } = require('../utils/usageKey');
const { rateLimit } = require('../middleware/rateLimit');
const c = require('../controllers/public.controller');

const router = express.Router();

router.use(analytics.logMiddleware); // first, so rejected and rate-limited calls are counted too
// Rate limit BEFORE the key check, so floods of key-less / wrong-key requests are throttled too.
router.use(rateLimit);
// Switch ON (default): no API key, no access. Switch OFF: key optional (a valid key still names the caller in Analytics).
// The chat server's usage reports (USAGE_KEY) always get in.
router.use(apiKeys.authMiddleware((req) => req.method === 'POST' && hasUsageKey(req)));

// ONE API for stickers and GIFs: choose with ?type=sticker | gif | all (default all). Item ids are unique across both.
router.get('/media', c.listHandler());
router.get('/media/packs', c.packsHandler());
router.get('/media/tags', c.tagsHandler());
router.get('/media/popular', c.popularHandler());
router.post('/media/:id/use', c.useHandler());

// Older per-kind endpoints (still working)
router.get('/stickers/popular', c.popularHandler('sticker'));
router.post('/stickers/:id/use', c.useHandler('sticker'));
router.get('/gifs/popular', c.popularHandler('gif'));
router.post('/gifs/:id/use', c.useHandler('gif'));

router.get('/stickers', c.listHandler('sticker'));
router.get('/packs', c.packsHandler('sticker'));
router.get('/tags', c.tagsHandler('sticker'));

router.get('/gifs', c.listHandler('gif'));
router.get('/gif-packs', c.packsHandler('gif'));
router.get('/gifs/tags', c.tagsHandler('gif'));

// Tell Analytics which paths are real, so rejected calls (401/429) are logged under their endpoint, not "unmatched"
analytics.setKnownPaths(router.stack.filter((l) => l.route).map((l) => `/api${l.route.path}`));

module.exports = router;
