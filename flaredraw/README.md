# FlareDraw

Excalidraw on Cloudflare. A self-hosted drawing and diagramming tool powered by the [@excalidraw/excalidraw](https://www.npmjs.com/package/@excalidraw/excalidraw) npm package, running entirely on Cloudflare Workers.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jezweb/flaredraw)

## Features

- Full Excalidraw editor (shapes, freehand, text, images, libraries)
- Auto-save to Cloudflare R2 (standard `.excalidraw` format)
- Drawing dashboard with grid view
- Share links with read-only snapshots
- Google OAuth sign-in via better-auth
- Dark/light/system theme
- Zero cold starts on Cloudflare Workers

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19 + Excalidraw + React Router |
| API | Hono on Cloudflare Workers |
| Database | D1 (SQLite) via Drizzle ORM |
| Storage | R2 (drawing content as `.excalidraw` JSON) |
| Auth | better-auth with Google OAuth |
| Styling | Tailwind v4 + shadcn/ui |
| Build | Vite + @cloudflare/vite-plugin |

## Setup

### Prerequisites

- Node.js 18+
- pnpm
- Cloudflare account
- Google Cloud OAuth credentials

### Install

```bash
git clone https://github.com/jezweb/flaredraw.git
cd flaredraw
pnpm install
```

### Configure

Create `.dev.vars` with your credentials:

```
BETTER_AUTH_SECRET=<random-secret>
BETTER_AUTH_URL=http://localhost:5173
GOOGLE_CLIENT_ID=<your-google-client-id>
GOOGLE_CLIENT_SECRET=<your-google-client-secret>
```

Generate a secret: `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`

### Google OAuth setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create an OAuth 2.0 Client ID (Web application)
3. Add authorised JavaScript origins: `http://localhost:5173`
4. Add authorised redirect URI: `http://localhost:5173/api/auth/callback/google`
5. Copy the Client ID and Client Secret to `.dev.vars`

### Database

```bash
pnpm db:migrate:local    # Set up local D1
```

### Run

```bash
pnpm dev
```

## Deploy to Cloudflare

```bash
# Create D1 database
npx wrangler d1 create flaredraw-db

# Update database_id in wrangler.jsonc

# Run migrations
pnpm db:migrate:remote

# Set secrets
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put BETTER_AUTH_URL
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET

# Deploy
pnpm deploy
```

Add your production domain to the Google OAuth authorised origins and redirect URIs.

## How it works

FlareDraw uses the Excalidraw npm package (not a fork) as its drawing engine. The integration surface is small:

- `onChange` with `getSceneVersion()` debouncing for auto-save
- `serializeAsJSON()` to store drawings in standard `.excalidraw` format on R2
- `initialData` to restore drawings from R2
- Share links create immutable R2 snapshots with a separate key

Drawing metadata (title, timestamps, user) lives in D1. The actual drawing content lives in R2 as standard Excalidraw JSON, so you can export and import with the official Excalidraw app.

## Licence

[MIT](LICENSE)
