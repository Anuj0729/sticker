const express = require('express');
const cors = require('cors');
const { ADMIN_ORIGIN, TRUST_PROXY } = require('./config/env');
const { analytics, apiKeys } = require('./services');
const { adminOnly } = require('./middleware/adminAuth');
const { errorHandler } = require('./middleware/errorHandler');
const adminRoutes = require('./routes/admin.routes');
const publicRoutes = require('./routes/public.routes');

const app = express();

// Behind Nginx / Render / Railway / Cloudflare, req.ip would be the proxy's IP (all users sharing one rate limit).
// Set TRUST_PROXY in .env: number of proxies in front (usually 1), or "true". Leave empty when not behind a proxy.
if (TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY === 'true' ? true : TRUST_PROXY);
app.use(express.json());
app.use('/admin', cors({ origin: ADMIN_ORIGIN }));
app.use('/api', cors()); // public API: open to any website/app (whether a key is needed is the admin's switch)

app.use('/admin', adminRoutes);
analytics.adminRoutes(app, adminOnly);
apiKeys.adminRoutes(app, adminOnly);
app.use('/api', publicRoutes);

app.use(errorHandler);

module.exports = app;
