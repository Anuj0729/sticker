# Sticker Studio

Admin panel (Next.js) + sticker API (Node/Express, built-in node:sqlite) with images on Cloudinary.

## Run
```bash
cd server && cp .env.example .env     # fill ADMIN_PASSWORD, JWT_SECRET, CLOUDINARY_*
npm install && npm run dev            # http://localhost:4000

cd ../admin && cp .env.local.example .env.local
npm install && npm run dev            # http://localhost:3000  (tester: /tester)
```

## One public API (no key)
`GET /api/stickers`

| Param | What it does |
|---|---|
| `pack` | Pack name (or id): all stickers of that pack |
| `tag` | Stickers with that tag first, then related ones (`match: "related"`) |
| `q` | Free text over tags and pack names |
| `related=0` | Turn related stickers off |
| `limit`, `offset` | Paging (default 30, max 100) |

Helpers: `GET /api/packs`, `GET /api/tags`. Filters combine, e.g. `?pack=Cats&tag=happy`.
Rate limit: 120 requests/minute/IP.
