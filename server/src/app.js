const express = require('express');
const cors = require('cors');
const { ADMIN_ORIGIN } = require('./config/env');
const { analytics, apiKeys } = require('./services');
const { adminOnly } = require('./middleware/adminAuth');
const { errorHandler } = require('./middleware/errorHandler');
const adminRoutes = require('./routes/admin.routes');
const publicRoutes = require('./routes/public.routes');

const app = express();
app.use(express.json());
app.use('/admin', cors({ origin: ADMIN_ORIGIN }));
app.use('/api', cors()); // public API: open to any website/app (whether a key is needed is the admin's switch)

app.use('/admin', adminRoutes);
analytics.adminRoutes(app, adminOnly);
apiKeys.adminRoutes(app, adminOnly);
app.use('/api', publicRoutes);

app.use(errorHandler);

module.exports = app;
