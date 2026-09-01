# SecondBrain — Turborepo

Multi-modal note-taking app with tag-based & AI-assisted recall.

## Stack
- **Next.js 15** (App Router — frontend + backend in one)
- **NextAuth v5** (Credentials + Google OAuth)
- **Prisma 6 + PostgreSQL** (database)
- **Redux Toolkit** (theme + UI state)
- **Tailwind CSS** (styling + 4 themes)
- **Turborepo** (monorepo)

## Structure
```
apps/
  web/                 → Next.js 15 full-stack app
    app/
      (auth)/          → login, signup pages
      (dashboard)/     → main dashboard
      note/[id]/       → note detail view
      addItem/         → Medium-like note editor
      settings/        → theme + layout preferences
      share/[hash]/    → public share page
      api/             → all API routes
    components/        → TopBar, SideBar, Content, ThemeProvider
    prisma/            → schema + migrations
    store/             → Redux (theme slice)
    auth.ts            → NextAuth config
    middleware.ts      → route protection

packages/
  types/               → shared TypeScript types
```

## Quick start

```bash
pnpm install
cp apps/web/.env.example apps/web/.env
# fill in DATABASE_URL, AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET

cd apps/web
pnpm db:push       # push schema to DB (creates all tables)
pnpm db:generate   # generate Prisma client
cd ../..
pnpm dev           # http://localhost:3000
```

> **Image uploads need one more service.** `pnpm dev` only starts the Node
> workspace packages (web, rag-backend, chat-backend) — it does **not** start
> the CLIP sidecar (`clip-sidecar/`, a separate Python/FastAPI service),
> since it isn't part of the pnpm workspace at all. Without it running,
> everything else works fine; only image uploads in `clip` mode fail (a
> `503` naming the sidecar). See `apps/rag-backend/README.md` → "Required
> Running Services" for how to start it.

## Getting Google OAuth credentials
1. Go to console.cloud.google.com → APIs & Services → Credentials
2. Create OAuth 2.0 Client ID (Web application)
3. Add Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
4. Copy Client ID and Secret into `.env`

## Generate AUTH_SECRET
```bash
npx auth secret
```

## Features
- ✅ Google OAuth + Email/Password login
- ✅ Medium-like rich text note editor (bold, italic, headings, lists)
- ✅ Dashboard with click-to-open note detail view
- ✅ Search by title, body text, or tag name
- ✅ Filter by content type (article, image, audio, video)
- ✅ 4 themes: Light, Dark, Sepia, Ocean
- ✅ 3 layouts: Compact (4 col), Comfortable (3 col), Spacious (2 col)
- ✅ Smooth page transitions
- ✅ Shareable link generation
- ✅ Tag management

## Public assets
Copy into `apps/web/public/`:
- `authImage.svg` `Logo.png` `profile.svg` `bin-icon.svg` `formBg.svg` `cloud-white-bg.mp4`

## Adding more apps
```bash
apps/chat-backend/   # WebSocket chat (ws library)
apps/ai-service/     # AI module (Rehan)
```
