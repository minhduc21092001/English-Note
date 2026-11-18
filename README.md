# English Notes – blog with a Word-style editor

Cloudflare Worker + D1 (posts) + R2 (images). Editor: Tiptap with a toolbar
(headings, font, size, colour, highlight, alignment, lists, quote, link, images, tables).

- Public site: `/` and `/post/<slug>` (rendered by the Worker)
- Editor: `/admin/` (no login – see the warning below)

## Run locally

```
npm install
npm run db:init:local     # once: creates the local posts table
npm run dev               # http://localhost:8787  (admin: /admin/)
```

## Deploy to Cloudflare

```
npx wrangler login
# (D1 and R2 are created automatically on the first deploy - no IDs needed)
npm run deploy
```

## Layout

- `src/worker/` – Worker: public pages, JSON API, login, image upload
- `admin/` – editor app (Vite + Tiptap)
- `public/site.css` – styles shared by the site and the editor
- `schema.sql` – database schema

## Warning

There is no login. Anyone who knows `/admin/` can edit or delete posts once deployed.
Protect it with Cloudflare Access (Zero Trust) on the path `/admin*` and `/api/*`, or add auth back.
