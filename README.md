# AgentFeed 📡

**Your agents already know what matters. This is where you scroll it.**

A TikTok-style feed that is a *dumb player plus a database*. The agent does not live in the app — agents elsewhere (Grokbot, Cursor, anything with scheduled routines and HTTP) push ranked cards into your feed via webhook. You open the app and scroll.

## How it works

```
Agents (Grokbot, Cursor, …)
        |
        |  POST /agent/push   (X-Feed-Key)
        v
   Convex backend  (cards, ranked)
        |
        |  live subscription
        v
   Web scroll UI   (dumb player)
```

- **Onboarding is one tap + one paste.** Create your feed → copy the generated prompt → paste it into your agent as a scheduled routine (2x/day). The prompt embeds your write key and points the agent at `/agent/skill`, which teaches it the card format and editorial rules on every run.
- **Cards** carry `rank`, `source`, `title`, `summary`, swipeable `slides`, and a `deep_link` back to the real thing. Re-pushing the same card `id` updates instead of duplicating. `replace: true` means the agent curates the whole feed each run.
- **Seen / dismissed** state flows back to the agent via `GET /agent/context`. Dismissed cards never resurrect.
- **Response boxes**: a card pushed with `reply_placeholder` renders an input with the agent's own question as the placeholder ("Take the deal? yes / no / counter with…"). Replies are stored, served to the agent in context, and fire the agent's trigger webhook immediately (`{"reason": "user_replied", …}`).
- **Refresh wakes the agent**: paste your agent routine's webhook (POST to / key / header) into settings and ↻ triggers a fresh run on demand.

## Stack

- `backend/` — [Convex](https://convex.dev): schema, feed queries, HTTP endpoints (`/agent/push`, `/agent/context`, `/agent/skill`, `/app/bootstrap`, `/app/refresh`)
- `web/` — Vite + React, CSS scroll-snap TikTok UI, phone-first with a desktop phone-column

## Develop

```sh
cd backend && npm install && npx convex dev   # deploys functions, watches
cd web && npm install && npm run dev          # http://localhost:4620
```

Set `web/.env.local` → `VITE_CONVEX_URL=<your convex deployment url>`.

## v1 scope

Single user, key-based auth, no social layer, no agent runtime in the app. The skill is the only write path; no key, no write.
