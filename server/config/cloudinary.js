const { v2: cloudinary } = require('cloudinary');

// Same approach as Karyantrix: three separate env vars + optional folder.
// Every sticker is uploaded to your Cloudinary account and its permanent
// secure_url is what we store in the database.

let configured = false;
const ensureConfigured = () => {
  if (configured) return;
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new Error('CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET must be set in .env');
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
  configured = true;
};

const folder = () => (process.env.CLOUDINARY_FOLDER || 'stickers').replace(/^\/+|\/+$/g, '');

// key like "12/uuid" -> public_id "stickers/12/uuid" (no extension, Cloudinary adds it)
const publicIdFromKey = (key) => `${folder()}/${key.replace(/\.[^./]+$/, '')}`;

const uploadBuffer = (key, buffer) => {
  ensureConfigured();
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        { public_id: publicIdFromKey(key), resource_type: 'image', overwrite: true },
        (error, result) => (error ? reject(error) : resolve(result))
      )
      .end(buffer);
  });
};

const deleteByPublicId = async (publicId) => {
  ensureConfigured();
  await cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true });
};

// https://res.cloudinary.com/<cloud>/image/upload/[v123/]<public_id>.<ext> -> public_id
const parseCloudinaryUrl = (url) => {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)cloudinary\.com$/i.test(parsed.hostname)) return null;
    const parts = parsed.pathname.replace(/^\/+/, '').split('/');
    const i = parts.indexOf('upload');
    if (i < 2) return null;
    let rest = parts.slice(i + 1);
    if (rest[0] && /^v\d+$/.test(rest[0])) rest = rest.slice(1);
    if (!rest.length) return null;
    rest[rest.length - 1] = rest[rest.length - 1].replace(/\.[^./]+$/, '');
    return decodeURIComponent(rest.join('/'));
  } catch { return null; }
};

// Best-effort cleanup; never throws.
const deleteByUrl = async (url) => {
  const publicId = url && parseCloudinaryUrl(url);
  if (!publicId) return;
  try { await deleteByPublicId(publicId); }
  catch (e) { console.error(`Failed to delete "${publicId}" from Cloudinary:`, e.message); }
};

// Delivery URL: auto format (WebP/AVIF) + auto quality, capped at 512px.
const deliveryUrl = (url) => url.replace('/upload/', '/upload/f_auto,q_auto,w_512,c_limit/');

module.exports = { cloudinary, ensureConfigured, uploadBuffer, deleteByUrl, deliveryUrl };
