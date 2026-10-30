require('./config/env'); // loads .env and validates it
require('./config/cloudinary').ensureConfigured(); // fail fast if Cloudinary env vars are missing

const app = require('./app');
const { PORT } = require('./config/env');

app.listen(PORT, () => console.log(`Sticker server on http://localhost:${PORT}`));
