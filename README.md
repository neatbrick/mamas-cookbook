# Mama's Cookbook

A responsive installable PWA cookbook for iPhone, Android, and desktop. Includes a recipe library, search, favorites, interactive ingredient checklists, manual entry, recipe URL import, and optional Supabase cloud accounts/sync.

## What works in this project

- Responsive cookbook UI designed for mobile and desktop.
- Add recipes manually or import a public recipe URL.
- Server-side webpage retrieval (not browser-side CORS fetch).
- Extracts Schema.org `Recipe` JSON-LD when available.
- Optional AI fallback (OpenAI API key stays on the server) for pages without complete structured recipe data.
- Ingredient checkboxes and progress tracking; checked state is saved.
- Favorites, search, delete, original source link.
- Local browser storage works before cloud is configured.
- Optional Supabase email auth and private per-user cloud storage.
- PWA manifest, service worker, offline app-shell caching, Android/Chromium Web Share Target.

## Requirements

- Node.js 20+
- A hosting service that supports a Node web process (Render, Railway, Fly.io, or a VPS)
- Optional: OpenAI API key for AI fallback
- Optional: Supabase project for accounts and cross-device cloud sync

## Run locally

```bash
cp .env.example .env
npm install
npm start
```

Open http://localhost:3000. Recipe URL importing requires the server to be running. For AI fallback, set `OPENAI_API_KEY` in `.env` and restart.

## Enable cloud accounts and sync

1. Create a Supabase project.
2. Open its SQL Editor and run `supabase-schema.sql`.
3. Copy the project URL and anon/public key from Project Settings > API.
4. Put those two public values in `public/config.js`:

```js
window.RECIPE_KEEPER_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR_SUPABASE_ANON_PUBLIC_KEY'
};
```

5. In Supabase Authentication settings, configure your production Site URL and allowed redirect URLs.
6. Redeploy the app. Users can create an account from the sign-in dialog (the dialog can be wired to a visible account button in a future UI pass; the auth controls are currently included in the page markup).

The SQL enables row-level security so each signed-in user can only read and change their own recipes. Never put a Supabase service-role key in the browser.

## Enable AI recipe extraction

Set these on the server host (not in `public/config.js`):

- `OPENAI_API_KEY`
- Optional `OPENAI_MODEL` (defaults to `gpt-4o-mini`)

The importer first looks for Schema.org recipe metadata. If that is missing or incomplete, it sends extracted page text to the configured OpenAI model and asks for structured recipe JSON. The importer does not guarantee every website will work: login-only pages, paywalls, bot protection, unusual layouts, and sites that disallow automated access can prevent extraction. Users can paste recipe text or enter recipes manually as a fallback.

## Install on phones

Deploy over HTTPS first.

- **iPhone:** Open the deployed URL in Safari → Share → Add to Home Screen.
- **Android:** Open the URL in Chrome → menu → Install app (or Add to Home screen).

Android Chromium browsers support the manifest `share_target` flow on supported devices. iOS Safari does not currently expose the same general-purpose web share-target receiving API to PWAs, so on iPhone users can open the app and paste the copied recipe URL. A native iOS Share Extension would require a native wrapper/app.

## Deployment notes

- Set the server's start command to `npm start` and use Node 20+.
- Add `OPENAI_API_KEY` and `OPENAI_MODEL` as server environment variables if using AI fallback.
- Configure `public/config.js` with the Supabase URL and anon key before deployment if using cloud accounts.
- Use HTTPS. Do not deploy with secrets in source control.
- The `/api/import` endpoint has URL validation, redirect limits, response-size limits, and public-IP checks to reduce SSRF risk. For production, also apply host-level outbound network restrictions, rate limiting, request logging, and a privacy policy/terms page.

## Current limitations / next production pass

- No hosted deployment or cloud project is created by this source package; you must connect your own hosting, Supabase, and AI credentials.
- Cloud merge currently favors existing cloud rows on ID collisions and uploads local-only rows after sign-in; it is not a full conflict-resolution engine.
- Add an account/settings screen and sign-out control before public launch.
- Add rate limiting, abuse monitoring, import quotas, accessibility QA, and a privacy policy before opening sign-ups publicly.
