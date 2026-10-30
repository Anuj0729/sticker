// Per-kind settings: stickers and GIFs share one UI, only the limits and wording differ (server enforces the same)
export const KINDS = {
  sticker: { noun: 'sticker', label: 'Stickers', accept: 'image/png,image/webp,image/gif,image/jpeg', maxMb: 5, maxFiles: 20 },
  gif: { noun: 'GIF', label: 'GIFs', accept: 'image/gif', maxMb: 10, maxFiles: 10 },
};
export const TABS = [...Object.entries(KINDS).map(([k, c]) => [k, c.label]), ['analytics', 'Analytics'], ['keys', 'API keys']];
