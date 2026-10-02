# Deploying the Hiraya frontend (Render Static Site)

The storefront **and** the staff console are one SPA build: the console lives at
`/superadmin` and is protected by the backend (Supabase aal2), not by a separate
bundle. (The older two-build / Apache layout described in earlier versions of this
file is no longer used.)

## Render settings

| Setting | Value |
|---|---|
| Service | Static Site `HirayaClassicApparel-1` |
| Root directory | `hiraya-frontend` |
| Build command | `npm install && npm run build` |
| Publish directory | `dist` |
| Auto-deploy | on push to `main` |

### Environment variables (baked in at build time)

| Variable | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://hiraya-classicapparel.onrender.com/api` |
| `VITE_SUPABASE_URL` | the Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | the Supabase anon (public) key |

After changing any `VITE_*` value, redeploy with **Clear build cache & deploy** —
Vite inlines them into the bundle.

### Redirects / Rewrites (order matters)

| # | Source | Destination | Action |
|---|---|---|---|
| 1 | `/supabase-storage/*` | `https://hiraya-classicapparel.onrender.com/supabase-storage/*` | Rewrite |
| 2 | `/*` | `/index.html` | Rewrite |

Rule 1 keeps catalog images same-origin (served by the backend proxy). It must be
above rule 2, or image requests receive `index.html`.

## Local development

`npm run dev` serves on `http://localhost:5173`. `.env.development.local` (gitignored)
points it at the local API: `VITE_API_BASE_URL=http://127.0.0.1:8000`. See the root
[README.md](../README.md) for the backend and the full system.
