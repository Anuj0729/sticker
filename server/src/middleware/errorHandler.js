const errorHandler = (err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'A file is too large (stickers max 5 MB, GIFs max 10 MB)' });
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Too many files in one upload' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
};

module.exports = { errorHandler };
