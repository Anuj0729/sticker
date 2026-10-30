const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');

const adminOnly = (req, res, next) => {
  try { jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Login required' }); }
};

module.exports = { adminOnly };
