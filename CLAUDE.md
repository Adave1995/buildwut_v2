# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## About Austin

Austin is non-technical. He does not write or review code directly. Claude is responsible for all GitHub actions — creating branches, committing, pushing, and opening PRs. Never ask Austin to run git commands manually.

---

## Source of truth

**Always read `BUILD_PLAN.md` at the start of every session.** It is the authoritative specification for what we're building, the tech stack, and the phased roadmap. If anything here conflicts with `BUILD_PLAN.md`, `BUILD_PLAN.md` wins. Ask Austin before guessing on ambiguities.

---

## Current status (updated 2026-04-08)

- **Phase 0 (foundation)** — complete
- **Phase 1 (HN ingest + sources health)** — complete
- **Phase 2 (scoring engine + feed)** — complete and deployed
- **Phase 3 (remaining sources)** — next ← START HERE

### Phase 3 checklist
Build in order. Each needs: connector file + cron route + registry update + `vercel.json` entry.

| # | Source | File | Key | Start enabled? | Schedule |
|---|---|---|---|---|---|
| 1 | Reddit | `lib/ingest/reddit.ts` | None | Yes | `0 * * * *` |
| 2 | Indie Hackers | `lib/ingest/indiehackers.ts` | None | Yes | `0 */6 * * *` |
| 3 | Apple RSS | `lib/ingest/apple-rss.ts` | None | Yes | `0 9 * * *` |
| 4 | GitHub Trending | `lib/ingest/github.ts` | PAT (in env) | Yes | `0 8 * * *` |
| 5 | Product Hunt | `lib/ingest/producthunt.ts` | OAuth2 (in env) | Yes | `0 */6 * * *` |
| 6 | X / Twitter | `lib/ingest/x-twitter.ts` | Bearer (in env) | **No** | `0 */2 * * *` |
| 7 | Google Trends | `lib/ingest/google-trends.ts` | None | **No** | `0 10 * * *` |

Pattern to follow: `lib/ingest/hn.ts` (connector) + `app/api/cron/hackernews/route.ts` (cron route).

---

## Commands

```bash
pnpm dev                    # Start local dev server
pnpm typecheck              # tsc --noEmit — must be clean before any phase is "done"
pnpm build                  # must pass before any phase is "done"
pnpm db:generate            # drizzle-kit generate → /supabase/migrations/
pnpm db:push                # apply migration to Supabase
pnpm test                   # vitest
pnpm test lib/ingest/resolver.test.ts   # resolver tests — run before merging resolver changes
```

---

## Cron route checklist

Every cron route must:
1. Verify `Authorization: Bearer ${CRON_SECRET}`
2. Check registry — bail if source is disabled
3. Call `source.ingest()`
4. Write a `source_run` row **regardless of outcome** (this is what `/sources` reads)
5. Return `{ok, itemsIngested, durationMs}`

Add the route to `vercel.json` crons array and redeploy. `maxDuration`: ingest routes = 30s, scoring = 60s.

---

## Critical rules

- **`raw_observation` is append-only.** Never update rows.
- **`score_snapshot` is immutable.** Write once; create a new row to re-score.
- **`prompts/score-v1.ts` is versioned.** Never edit in place — bump the version number.
- **Entity resolver** — do not change matching logic without running resolver tests first.
- **No Reddit OAuth** — use public JSON (`reddit.com/r/{sub}.json`) with `User-Agent: buildwut/0.1 (personal tool)`.
- **Google Trends is non-blocking** — on failure, log `partial` in `source_run` and continue.
- **Grok is enrichment-only** — it never produces a score. Claude produces all scores.
- **Score ≤50 entities/day** in V1. Check daily budget before calling Claude.
- **Rate limits are sacred** — never exceed any source's documented limit.
- **Secrets never logged.** Sentry scrubbing must be configured.
- Always work on a feature branch, never commit directly to `main`.

---

## Key env var notes

See `.env.example` and `BUILD_PLAN.md` section 12 for the full list. Quirks worth knowing:

- **Product Hunt:** `PRODUCT_HUNT_API_KEY` = client ID, `PRODUCT_HUNT_API_SECRET` = client secret. The connector must exchange these for a bearer token at runtime via OAuth2 `client_credentials`.
- **Reddit + Google Trends:** no API keys needed.
- **`DATABASE_URL`:** use Transaction Pooler (port 6543), not the direct connection (port 5432).
