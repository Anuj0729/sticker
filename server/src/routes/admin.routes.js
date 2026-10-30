const express = require('express');
const { adminOnly } = require('../middleware/adminAuth');
const { pickUploader } = require('../middleware/upload');
const c = require('../controllers/admin.controller');

const router = express.Router();

router.post('/login', c.login);

// packs (?kind=sticker|gif)
router.get('/packs', adminOnly, c.listPacks);
router.post('/packs', adminOnly, c.createPack);
router.patch('/packs/:id', adminOnly, c.updatePack);
router.delete('/packs/:id', adminOnly, c.deletePack);

// items inside a pack (stickers or GIFs, decided by the pack)
router.post('/packs/:id/stickers', adminOnly, pickUploader, c.addStickers);
router.patch('/stickers/:id', adminOnly, c.updateSticker);
router.delete('/stickers/:id', adminOnly, c.deleteSticker);

module.exports = router;
