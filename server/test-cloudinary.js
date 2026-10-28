require('dotenv').config();
const { cloudinary, ensureConfigured } = require('./config/cloudinary');

ensureConfigured();
cloudinary.api.ping()
  .then((r) => console.log('OK', r))
  .catch((e) => console.log('FAILED', e.http_code, e.message));
