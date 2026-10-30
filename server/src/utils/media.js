const { deliveryUrl } = require('../config/cloudinary');

const gifFit = (u) => u.replace('/upload/', '/upload/w_480,c_limit,q_auto/'); // lighter GIF, max 480px wide
const mediaUrl = (file, kind) => (kind === 'gif' ? gifFit(file) : deliveryUrl(file)); // `file` holds the Cloudinary secure_url
const sticker = (s, kind = 'sticker') => ({
  id: s.id, packId: s.pack_id, url: mediaUrl(s.file, kind),
  ...(kind === 'gif' && { original: s.file }),
  tags: s.tags ? s.tags.split(',') : [], animated: kind === 'gif' || !!s.animated,
});
const cleanTags = (t) => String(t || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).join(',');
const kindOf = (v) => (v === 'gif' ? 'gif' : 'sticker');
const norm = (v) => String(v || '').trim().toLowerCase();

module.exports = { mediaUrl, sticker, cleanTags, kindOf, norm };
