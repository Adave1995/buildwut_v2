# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## About Austin

Austin is non-technical. He does not write or review code directly. Claude is responsible for all GitHub actions — creating branches, committing, pushing, and opening PRs. Never ask Austin to run git commands manually.

---

## Source of truth

**Always read `BUILD_PLAN.md` at the start of every session.** It is the authoritative specification for what we're building, the tech stack, and the phased roadmap. If anything here conflicts with `BUILD_PLAN.md`, `BUILD_PLAN.md` wins. Ask Austin before guessing on ambiguities.

---

## Current status (updated 2026-04-09)

- **Phase 0 (foundation)** — complete
- **Phase 1 (HN ingest + sources health)** — complete
- **Phase 2 (scoring engine + feed)** — complete
- **Phase 3 (remaining sources)** — complete
- **Phase 4 (workflow features)** — complete
- **Phase 5 (alerts + polish)** — in progress ← START HERE

### Phase 5 checklist
- [x] Signals tab on opportunity detail (Recharts, `metric_timeseries`)
- [x] Alert rules engine — `app/api/cron/run-alerts/route.ts`, every 30 min
- [x] Alert management page — `/alerts` with create/toggle/delete
- [x] In-app notification badge on Alerts nav item
- [x] Daily email digest — `app/api/cron/digest/route.ts`, 8am daily via Resend
- [ ] Deploy and verify end-to-end in production

### Phase 6 (next)
- Onboarding tour (deferred from Phase 5)
- See `BUILD_PLAN.md` section 14 for full Phase 6 scope

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
- **Reddit is currently disabled** — Vercel's IPs are blocked by Reddit as of 2026. The source is set to `enabled: false` in the registry. Austin applied for official API access (~April 2026) but has not received a response. When re-enabling, pick one of these approaches:
  1. **Cloudflare Worker proxy** (recommended) — ~10-line Worker that fetches `reddit.com/r/{sub}.json` from Cloudflare's IPs and forwards to Vercel. Free tier, zero infra to manage.
  2. **Third-party RSS middleman** — use a service like FetchRSS to consume Reddit RSS feeds (`reddit.com/r/{sub}.rss`) so requests come from their servers, not Vercel's. Lowest-code option but adds a third-party dependency.
  3. **Official API** — if the API access application is ever approved, update the ingester to use `oauth.reddit.com` with a bearer token and store `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` in env.
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
- **Reddit:** currently disabled (see Critical rules above). No env vars needed until re-enabled via one of the proxy options.
- **`DATABASE_URL`:** use Transaction Pooler (port 6543), not the direct connection (port 5432).
- **`DIGEST_EMAIL`:** email address for the daily digest. Falls back to first entry in `ALLOWED_SIGNUP_EMAILS` if not set.
- **`NEXT_PUBLIC_APP_URL`:** public app URL used in digest email links (e.g. `https://buildwut.vercel.app`).
- **`RESEND_API_KEY`:** now active (Phase 5). `from` address is `digest@buildwut.app` — add that domain in Resend dashboard.
