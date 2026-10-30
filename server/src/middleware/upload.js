const multer = require('multer');
const db = require('../config/db');

const upload = multer({ // stickers
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 20 },
  fileFilter: (_, f, cb) => cb(null, /^image\/(png|webp|gif|jpeg)$/.test(f.mimetype)),
});
const uploadGif = multer({ // GIF packs
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter: (_, f, cb) => cb(null, f.mimetype === 'image/gif'),
});

const pickUploader = (req, res, next) => {
  const pack = db.prepare('SELECT id, kind FROM packs WHERE id=?').get(req.params.id);
  if (!pack) return res.status(404).json({ error: 'Pack not found' });
  req.pack = pack;
  (pack.kind === 'gif' ? uploadGif.array('files', 10) : upload.array('files', 20))(req, res, next);
};

module.exports = { pickUploader };
