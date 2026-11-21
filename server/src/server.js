// node:sqlite needs Node 22.13 or newer - fail with a clear message instead of a confusing crash
{
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 22 || (maj === 22 && min < 13)) {
    console.error(`Node ${process.versions.node} is too old. This server needs Node 22.13 or newer (built-in node:sqlite).`);
    process.exit(1);
  }
}

require('./config/env'); // loads .env and validates it
require('./config/cloudinary').ensureConfigured(); // fail fast if Cloudinary env vars are missing

const app = require('./app');
const { PORT, USAGE_KEY } = require('./config/env');

if (!USAGE_KEY) console.warn('[security] USAGE_KEY is not set: anyone with API access can report sticker usage. Set it in .env.');

app.listen(PORT, () => console.log(`Sticker server on http://localhost:${PORT}`));
