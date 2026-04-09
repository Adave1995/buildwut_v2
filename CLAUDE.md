# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Source of truth

**Always read `BUILD_PLAN.md` at the start of every session.** It is the authoritative specification for what we're building, the tech stack, and the phased roadmap. If anything here conflicts with `BUILD_PLAN.md`, `BUILD_PLAN.md` wins. Ask Austin before guessing on ambiguities.

---

## Current status (updated 2026-04-08)

- **Phase 0 (foundation)** — complete and deployed
- **Phase 1 (HN ingest + sources health page)** — complete and live
- **Phase 2 (scoring engine + feed)** — complete and deployed on main; Vercel cron jobs active
- **Phase 3 (remaining sources)** — next ← START HERE

### Phase 3 checklist
Build these in order. Each needs: a connector file + a cron route + registry update + vercel.json entry.

| # | Source | File | Key | Start enabled? | Schedule |
|---|---|---|---|---|---|
| 1 | Reddit | `lib/ingest/reddit.ts` | None | Yes | `0 * * * *` |
| 2 | Indie Hackers | `lib/ingest/indiehackers.ts` | None | Yes | `0 */6 * * *` |
| 3 | Apple RSS | `lib/ingest/apple-rss.ts` | None | Yes | `0 9 * * *` |
| 4 | GitHub Trending | `lib/ingest/github.ts` | PAT (in env) | Yes | `0 8 * * *` |
| 5 | Product Hunt | `lib/ingest/producthunt.ts` | OAuth2 (in env) | Yes | `0 */6 * * *` |
| 6 | X / Twitter | `lib/ingest/x-twitter.ts` | Bearer (in env) | **No** | `0 */2 * * *` |
| 7 | Google Trends | `lib/ingest/google-trends.ts` | None | **No** | `0 10 * * *` |

**Pattern to follow:** `lib/ingest/hn.ts` (connector) + `app/api/cron/hackernews/route.ts` (cron route).
After each connector: add to `lib/sources/registry.ts` and `vercel.json` crons array.

### Phase 2 deployment notes (for reference)
- Vercel Pro plan — all crons run natively via vercel.json (no cron-job.com)
- `maxDuration`: ingest routes = 30s, score-pending = 60s
- Grok enrichment enabled by default in scorer.ts (`withGrok = true`)
- New Anthropic API key added 2026-04-08

---

## Commands

```bash
# Development
pnpm dev                    # Start local dev server

# Type safety (must be clean before any phase is "done")
pnpm typecheck              # tsc --noEmit

# Build (must pass before any phase is "done")
pnpm build

# Database
pnpm db:generate            # drizzle-kit generate → outputs SQL to /supabase/migrations/
pnpm db:push                # apply migration to Supabase (or use Supabase SQL editor)

# Tests (resolver unit tests are mandatory; run them before merging)
pnpm test                   # vitest
pnpm test lib/ingest/resolver.test.ts   # run resolver tests specifically
```

---

## Architecture overview

This is a **single-user personal opportunity radar** built on Next.js 15 App Router. The system has four layers:

### 1. Ingestion layer (`/lib/ingest/`)
One file per data source. Each exports a `run(): Promise<IngestResult>` function. Sources are registered in `/lib/sources/registry.ts` — this is the **only place** sources are wired up. Cron handlers call the registry; they don't import ingest files directly.

Sources pull data → normalize it → resolve entities → write `raw_observation` rows (append-only, never updated). Sources include: Hacker News, Product Hunt, Reddit (public JSON — no OAuth), GitHub Trending, Apple RSS, X API v2, Google Trends (unofficial npm, non-blocking), Indie Hackers RSS.

### 2. Entity resolver (`/lib/ingest/resolver.ts`)
The most critical correctness piece. Matches incoming observations to existing `entity` rows via five ordered strategies: exact `external_ids` match → exact domain → exact GitHub repo → fuzzy name match (`pg_trgm` similarity > 0.85 within same category) → create new. **Unit tested.** Do not change matching logic without running tests.

### 3. Scoring engine (`/lib/scoring/`)
Triggered by `/api/cron/score-pending` for entities crossing an interestingness threshold (≥10 mentions/24h or momentum jump >20pts).

Flow: compute metrics → **Grok enrichment** → Claude scoring → write `score_snapshot`.

- `grok-enricher.ts` — calls xAI Grok API twice per entity: (1) X post search for product name (last 7d), (2) web search for "[name] reviews/launch/feedback". Returns up to 5 snippets each. Wrapped in try/catch; failure is non-fatal.
- `prompts/score-v1.ts` — versioned Claude prompt. **Never edit in place — bump the version.** Grok snippets are appended as `additional_evidence`. Claude returns structured output: 6 sub-scores, reasoning, red flags, evidence array, adjacent niches array.
- `score_snapshot` rows are **immutable** once written (explainability requires this).

### 4. Web app (`/app/`)

Route groups:
- `/(auth)` — login/signup (magic link only), unprotected
- `/(dashboard)` — all main app pages, protected by Supabase auth middleware

Key pages: `/feed` (ranked opportunity feed, the home screen), `/opportunities/[id]` (tabs: Overview, Adjacent Niches, Signals, Raw Evidence, My Notes), `/pipeline` (kanban with `@dnd-kit`), `/watchlists`, `/sources` (health dashboard — check this when something breaks), `/settings`.

**Default pattern:** server components everywhere; client components only for interactivity (drag-drop, filter state, markdown editor).

---

## Data model principles

- `raw_observation` is **append-only**. Never update rows.
- `score_snapshot` is **immutable**. Write once; create a new row to update.
- `entity`, `raw_observation`, `metric_timeseries`, `score_snapshot` — shared across users, readable by any authenticated user, writable only by service role.
- All user-scoped tables (`watchlist`, `pipeline_item`, `alert_rule`, `alert_event`) enforce RLS with `user_id = auth.uid()`.
- All schema lives in `/lib/db/schema.ts`. Generate migrations with Drizzle — never write SQL by hand.

---

## Cron routes (`/app/api/cron/`)

Every cron route must:
1. Verify `Authorization: Bearer ${CRON_SECRET}`
2. Check registry — bail if source is disabled
3. Call `source.ingest()`
4. Write a `source_run` row **regardless of outcome** (this is what `/sources` reads)
5. Return `{ok, itemsIngested, durationMs}`

**Scheduling: Vercel cron (native).** Project is on Vercel Pro — all cron jobs are defined in `vercel.json` under the `"crons"` key. Vercel automatically injects `Authorization: Bearer {CRON_SECRET}` on each invocation, which the routes verify. New cron routes must be added to `vercel.json` and redeployed — no external service needed.

X API and Google Trends sources start with `enabled: false` in the registry. Enable manually after confirming they work without errors.

---

## Key constraints

- **No Reddit OAuth** — use public JSON endpoint (`reddit.com/r/{sub}.json`). No credentials needed, just `User-Agent: buildwut/0.1 (personal tool)`.
- **Google Trends is non-blocking** — if the unofficial npm package fails, log `partial` in `source_run` and continue. Never let it break scoring.
- **Grok is enrichment-only** — it never produces a score. Claude produces all scores.
- **Score at most ~50 entities/day** in V1. Check daily budget before calling Claude.
- **Rate limits are sacred** — never exceed any source's documented limit. Use token bucket or simple sleep between requests.
- **Vercel Pro function timeout.** Set `maxDuration` per route: ingest routes use 30s, scoring uses 60s. Ingest functions should still budget time internally and stop gracefully if work remains (let the next run continue).
- **Secrets never logged.** Sentry scrubbing must be configured.
- Always work on a feature branch, never commit directly to `main`.

---

## Infrastructure decisions (locked)

| Decision | Choice | Reason |
|---|---|---|
| Cron scheduling | **Vercel cron** (native, `vercel.json`) | Project on Pro — no external scheduler needed |
| DATABASE_URL | **Transaction Pooler** (port 6543) | Serverless-safe; direct connection exhausts Supabase limits |
| Auth | Supabase magic link | Redirect URL must be whitelisted in Supabase → Authentication → URL Configuration |

---

## Environment variables

See `.env.example` for the full list. Key groupings:
- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`
- AI: `ANTHROPIC_API_KEY`, `XAI_API_KEY`
- Sources: `X_API_BEARER_TOKEN`, `PRODUCT_HUNT_API_KEY`, `PRODUCT_HUNT_API_SECRET`, `GITHUB_PERSONAL_ACCESS_TOKEN`
- X OAuth (future use): `X_SECRET_KEY`, `X_CONSUMER_KEY`
- Infra: `CRON_SECRET`, `ALLOWED_SIGNUP_EMAILS`, `SENTRY_DSN`
- Reddit and Google Trends require **no API keys**.

**Product Hunt note:** Austin has OAuth2 client credentials (`PRODUCT_HUNT_API_KEY` = client ID, `PRODUCT_HUNT_API_SECRET` = client secret). The PH connector must exchange these for a bearer token at runtime before calling the GraphQL API.

---

## Supabase setup checklist (for new environments)

1. Run migration: `supabase/migrations/0000_steady_mongoose.sql` in SQL editor
2. Enable pg_trgm: `CREATE EXTENSION IF NOT EXISTS pg_trgm;`
3. Set Site URL in Authentication → URL Configuration
4. Add redirect URL: `https://{your-domain}/api/auth/callback`
