const sharp = require('sharp');

// Free, local background removal (no API key, no add-on).
// The AI model runs on your own server. First image is slower (model loads),
// the next ones take a few seconds each.
const enabled = () => (process.env.BG_REMOVAL || 'on').toLowerCase() !== 'off';

let lib;
let queue = Promise.resolve(); // process one image at a time so the CPU/RAM don't spike

const run = async (buffer) => {
  lib ||= import('@imgly/background-removal-node'); // ESM package, loaded from CommonJS
  const { removeBackground } = await lib;

  // Downscale first: faster, and keeps the transparent PNG small for upload
  const prepared = await sharp(buffer)
    .rotate()
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();

  const blob = await removeBackground(new Blob([prepared], { type: 'image/png' }), {
    model: process.env.BG_MODEL || 'medium', // 'small' = faster, 'medium' = cleaner edges
    output: { format: 'image/png' },
  });
  return Buffer.from(await blob.arrayBuffer());
};

const removeBg = (buffer) => {
  const job = queue.then(() => run(buffer));
  queue = job.catch(() => {});
  return job;
};

module.exports = { removeBg, enabled };