require('dotenv').config();

const { PORT = 4000, ADMIN_PASSWORD, JWT_SECRET, ADMIN_ORIGIN = 'http://localhost:3000', USAGE_KEY = '', DB_PATH, LOG_RETENTION_DAYS = '90', TRUST_PROXY = '', REQUIRE_API_KEY = '1' } = process.env;
if (!ADMIN_PASSWORD || !JWT_SECRET) throw new Error('Set ADMIN_PASSWORD and JWT_SECRET in .env');

if (ADMIN_PASSWORD.length < 12) console.warn('[security] ADMIN_PASSWORD is shorter than 12 characters. Use a long, random password.');

module.exports = { PORT, ADMIN_PASSWORD, JWT_SECRET, ADMIN_ORIGIN, USAGE_KEY, DB_PATH, LOG_RETENTION_DAYS, REQUIRE_API_KEY, TRUST_PROXY };
