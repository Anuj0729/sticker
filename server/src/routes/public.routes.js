const express = require('express');
const { analytics, apiKeys } = require('../services');
const { hasUsageKey } = require('../utils/usageKey');
const { rateLimit } = require('../middleware/rateLimit');
const c = require('../controllers/public.controller');

const router = express.Router();

router.use(analytics.logMiddleware); // first, so rejected and rate-limited calls are counted too
// Switch ON (default): no API key, no access. Switch OFF: key optional (a valid key still names the caller in Analytics).
// The chat server's usage reports (USAGE_KEY) always get in.
router.use(apiKeys.authMiddleware((req) => req.method === 'POST' && hasUsageKey(req)));

router.use(rateLimit);

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

module.exports = router;
