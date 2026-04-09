# BuildWut — Build Plan for Claude Code

> **Read this whole document before writing any code.** This is the source of truth for what we're building, why, and in what order. If anything in this doc conflicts with assumptions you'd otherwise make, this doc wins. If something is genuinely ambiguous, stop and ask Austin (the owner) before guessing.

---

## 1. Project overview

**Product name (working):** BuildWut

**One-line pitch:** A personal "opportunity radar" that ingests signals from launch platforms, dev communities, social, and app stores; uses AI to score each product on momentum, engagement quality, and distribution gap; and — most importantly — proposes adjacent niches where a similar product could win.

**Who it's for (today):** Austin only. Single user. Personal tool.

**Who it might be for later:** A small group of paying indie founders / solo builders (≤50 users). Build everything multi-tenant from day one so this is a config flip, not a rewrite. Do **not** build billing, team workspaces, or org-level admin in V1.

**The core thesis driving the product:**
1. By the time something is *obviously* trending, the original team has usually locked in dominance. Pure copycatting rarely works.
2. The real arbitrage is **"good product, bad marketing"** — apps with strong engagement relative to their reach (the "distribution gap").
3. The other real arbitrage is **niche transposition** — taking a pattern that's working in one vertical and rebuilding it for an adjacent vertical that hasn't been served yet. Example: "Linear is winning in dev tools → who's winning in this format for legal teams? Nobody yet."
4. Therefore the product's #1 job is not to *list trending apps*. It's to surface **opportunities Austin can actually act on**, with a clear "why now" and a clear "adjacent niche where this could win."

**Non-goals (explicitly):**
- This is not a Crunchbase competitor.
- This is not a market intelligence SaaS for enterprises.
- This is not a real-time trading-style dashboard. Daily freshness is fine.
- We are not building team collaboration, billing, SSO, or admin panels in V1.
- We are not scraping anything that violates ToS. If a source requires a commercial agreement and we don't have one, we don't ingest it.

---

## 2. Product principles (use these to break ties)

1. **Action over information.** Every screen should answer "what should I do next?" not "what is happening?"
2. **Adjacency over imitation.** Surface the niche transposition, not just the original.
3. **Explainability is non-negotiable.** Every score must show its work. No black boxes. Austin needs to trust this.
4. **Boring tech, fast iteration.** Pick the most boring stack that lets us ship in days, not weeks.
5. **Rate limits are sacred.** Never exceed any source's documented rate limit. Always identify the app with a real User-Agent and contact email.
6. **Multi-tenant data model, single-tenant UX (for now).** Database has `user_id` everywhere; UI has no team features.

---

## 3. Tech stack (locked)

Do not substitute these without checking with Austin first.

| Layer | Choice | Why |
|---|---|---|
| Hosting | **Vercel** | Owner preference; Next.js native; built-in cron |
| Framework | **Next.js 15 (App Router)** + **TypeScript** | Standard for Vercel; server actions simplify API |
| Database | **Supabase Postgres** | Owner preference; auth + storage included |
| Auth | **Supabase Auth** (email magic link to start) | Bundled with Supabase |
| ORM / DB client | **Drizzle ORM** with `postgres-js` driver | Type-safe, lightweight, plays well with Supabase |
| UI | **shadcn/ui** + **Tailwind CSS** + **lucide-react** icons | Fast, owner can tweak later |
| Charts | **Recharts** | Simple, no D3 learning curve |
| Tables | **TanStack Table** | Best-in-class for sortable/filterable feeds |
| AI scoring | **Anthropic Claude API** (`claude-sonnet-4-6`) via official SDK | Owner is in Anthropic ecosystem |
| Social signals | **X API v2** (pay-as-you-go Bearer Token) | Austin has access; pay-per-use; replaces Reddit OAuth for social listening |
| Scoring enrichment | **Grok API** (xAI) | X-native post search + web search; feeds evidence snippets into Claude's scoring context |
| Background jobs | **Vercel Cron** + **Vercel Queues** (or Inngest if Queues aren't enabled) | No separate worker infra needed |
| HTTP client | `fetch` + `undici` for ingestion | No axios |
| Validation | **Zod** | Standard with Drizzle/Next |
| Logging | **Pino** + Vercel logs | Cheap, structured |
| Error tracking | **Sentry** (free tier) | Add early, it pays for itself |
| Env management | `.env.local` for dev, Vercel env vars for prod | Standard |
| Package manager | **pnpm** | Faster, stricter than npm |

**Repo layout:**

```
/app                  # Next.js App Router pages
  /(auth)             # login, signup
  /(dashboard)        # main app, requires auth
    /feed             # ranked opportunity feed
    /opportunities/[id]  # detail view
    /watchlists
    /pipeline         # kanban
    /sources          # source health dashboard
    /settings
/components           # shadcn/ui + custom
/lib
  /db                 # drizzle schema, client, migrations
  /ingest             # one file per source connector
  /scoring            # AI scoring + adjacency engine
  /sources            # source registry + rate limit policy
  /utils
/app/api              # API routes (REST)
  /cron               # Vercel cron handlers
  /webhooks
/types
/scripts              # one-off scripts (seed, backfill)
/supabase             # supabase migration files (mirror of drizzle)
```

---

## 4. High-level architecture

```
                ┌─────────────────────────────────────────────┐
                │                  Vercel Cron                 │
                │   (hourly + daily jobs hit /api/cron/*)      │
                └──────────────────────┬──────────────────────┘
                                       │
                                       ▼
        ┌──────────────────────────────────────────────────────┐
        │                  Ingestion Layer                      │
        │   /lib/ingest/{producthunt,hn,reddit,github,...}.ts  │
        │   - Fetch from source (respecting rate limits)        │
        │   - Normalize into `raw_observation` rows             │
        │   - Upsert into `entity` table via entity resolver    │
        └──────────────────────┬───────────────────────────────┘
                               │
                               ▼
        ┌──────────────────────────────────────────────────────┐
        │              Feature & Metric Layer                   │
        │   - Compute rolling velocity / mention deltas         │
        │   - Update `metric_timeseries`                        │
        │   - Trigger scoring for entities crossing thresholds  │
        └──────────────────────┬───────────────────────────────┘
                               │
                               ▼
        ┌──────────────────────────────────────────────────────┐
        │           AI Scoring + Adjacency Engine               │
        │   - Calls Claude API per entity                       │
        │   - Returns sub-scores + reasoning + adjacent niches  │
        │   - Stored in `score_snapshot` (immutable)            │
        └──────────────────────┬───────────────────────────────┘
                               │
                               ▼
        ┌──────────────────────────────────────────────────────┐
        │                   Next.js Web App                     │
        │   - Reads from Supabase via Drizzle on the server     │
        │   - Server components by default                      │
        │   - Client components only for interactivity          │
        └──────────────────────────────────────────────────────┘
```

**Key principle:** Raw observations are immutable (append-only). Anything derived (metrics, scores) is recomputed from raw and stored as snapshots. This is what makes the explainability story work.

---

## 5. Data sources (V1 ingestion plan)

Build these connectors in this order. Each connector is one file under `/lib/ingest/`. Each must export a `run()` function that's called by a Vercel cron route.

### V1 sources (all free, all compliant for personal use)

| # | Source | Endpoint | Cadence | Rate limit | Notes |
|---|---|---|---|---|---|
| 1 | **Hacker News** | `https://hacker-news.firebaseio.com/v0/` | every 30 min | none documented, be polite | Pull `topstories`, `newstories`, and any `Show HN` from `/v0/item/{id}`. This is the highest-signal source for V1. |
| 2 | **Product Hunt** | GraphQL: `https://api.producthunt.com/v2/api/graphql` | every 6 hours | 6250 complexity points / 15 min | Personal use only — Austin must register a developer app and get an OAuth token. Do **not** ship this in any commercial version without re-checking ToS. Pull today's launches + this week's top. |
| 3 | **Reddit** | `https://www.reddit.com/r/{sub}.json` | every 1 hour | None (User-Agent header only) | No OAuth needed — public JSON endpoint. 60 req/min unauthenticated. Use `User-Agent: buildwut/0.1 (personal tool)`. Subreddits: `r/SideProject`, `r/SaaS`, `r/startups`, `r/Entrepreneur`, `r/InternetIsBeautiful`, `r/microsaas`, `r/indiehackers`. 1s delay between subreddit calls. |
| 4 | **GitHub Trending** | No official API; use the unofficial endpoint `https://api.gitterapp.com/repositories?since=daily` OR scrape `https://github.com/trending` HTML | daily | 60/hr unauth, 5000/hr authed | Authenticate with a personal access token to get the higher limit. |
| 5 | **Apple App Store RSS** | `https://rss.applemarketingtools.com/api/v2/us/apps/top-free/25/apps.json` (and `top-paid`, plus other locales) | daily | none documented | Snapshot rank positions; compute Δrank in the metric layer. |
| 6 | **X / Twitter** | X API v2 `GET /2/tweets/search/recent` | every 2 hours | Bearer Token (pay-as-you-go) | Search recent tweets for product names + `#buildinpublic`, `#indiehackers`, `#saas`. Store as `mention` observations. Start with `enabled: false` in the registry; flip on after first manual test. |
| 7 | **Google Trends** | `google-trends-api` npm package (unofficial) | daily | None | Unofficial scraper that wraps Google's frontend. Wrap every call in try/catch — if it fails, `source_run` logs `partial` and cron continues. **Never a blocking dependency.** Start with `enabled: false`; flip on after confirming it works. |
| 8 | **Indie Hackers** | RSS: `https://www.indiehackers.com/feed.xml` | every 6 hours | none | Lower priority but cheap to add. |

### Sources explicitly **not** in V1 (and why)
- **TikTok Research API** — researcher-only, structurally unreliable for our use case.
- **Crunchbase / Similarweb / Sensor Tower** — paid, requires license. Add as a "bring your own key" feature in a later phase.
- **Google Play scraping** — ToS gray area. Skip until we find a clean source.

### Source registry pattern

Every source must be registered in `/lib/sources/registry.ts` with:

```typescript
interface SourceDefinition {
  id: string;                    // 'hackernews'
  name: string;                  // 'Hacker News'
  enabled: boolean;              // kill switch
  cadenceCron: string;           // '*/30 * * * *'
  rateLimit: { requests: number; perSeconds: number };
  licensingState: 'free' | 'personal-only' | 'licensed' | 'restricted';
  ingest: () => Promise<IngestResult>;
}
```

This registry is the only place sources are wired up. Cron handlers iterate it.

---

## 6. Database schema (Supabase / Drizzle)

All tables use UUIDs (`uuid_generate_v4()`) for primary keys unless noted. All tables include `created_at timestamptz default now()`. All user-scoped tables include `user_id uuid references auth.users(id) on delete cascade`. Enable Row Level Security (RLS) on every table; policies enforce `user_id = auth.uid()` for user-scoped tables.

### Core tables

**`entity`** — A discovered product/app/repo/company.
- `id` uuid pk
- `slug` text unique  (e.g., `producthunt:linear-app` or `hn:38291749`)
- `name` text
- `description` text
- `url` text
- `category` text  (AI-classified, not free-text from sources)
- `platform` text[]  (`['web','ios','android','macos']`)
- `first_seen_at` timestamptz
- `last_seen_at` timestamptz
- `external_ids` jsonb  (`{producthunt: 12345, github: 'org/repo', domain: 'foo.com'}`)
- `metadata` jsonb

**`raw_observation`** — Append-only event log. Never updated.
- `id` uuid pk
- `entity_id` uuid (nullable until resolved)
- `source_id` text  (`hackernews`, `producthunt`, ...)
- `source_event_id` text  (whatever the source uses; for dedup)
- `event_type` text  (`launch`, `mention`, `rank_snapshot`, `comment`, `star`)
- `payload` jsonb  (raw normalized event data)
- `observed_at` timestamptz
- `ingested_at` timestamptz default now()
- unique index on (`source_id`, `source_event_id`)

**`metric_timeseries`** — Computed metrics per entity over time.
- `id` bigserial pk
- `entity_id` uuid not null
- `metric_name` text  (`mentions_24h`, `rank_apple_topfree`, `hn_score`, `reddit_engagement`, ...)
- `t` timestamptz
- `value` numeric
- index on (`entity_id`, `metric_name`, `t desc`)

**`score_snapshot`** — Immutable AI scoring result.
- `id` uuid pk
- `entity_id` uuid not null
- `as_of` timestamptz
- `total_score` int  (0–100)
- `momentum_score` int
- `engagement_quality_score` int
- `distribution_gap_score` int
- `market_tailwinds_score` int
- `fundamentals_score` int
- `execution_feasibility_score` int
- `reasoning` text  (Claude's "why this score" narrative)
- `evidence` jsonb  (array of `{source, url, snippet, signal_type}`)
- `adjacent_niches` jsonb  (array of `{niche, rationale, why_it_could_win, suggested_angle}`)
- `model` text  (e.g., `claude-sonnet-4-6`)
- `prompt_version` text  (so we can recompute when we tune the prompt)

**`watchlist`**
- `id` uuid pk
- `user_id` uuid
- `name` text
- `filter` jsonb  (saved feed filters)

**`watchlist_entity`** (many-to-many)
- `watchlist_id` uuid
- `entity_id` uuid
- pk on both

**`pipeline_item`** — Kanban card.
- `id` uuid pk
- `user_id` uuid
- `entity_id` uuid
- `stage` text  (`inbox` | `shortlist` | `investigating` | `building` | `archived`)
- `notes` text
- `priority` int default 0
- `updated_at` timestamptz

**`alert_rule`**
- `id` uuid pk
- `user_id` uuid
- `name` text
- `condition` jsonb  (`{type: 'score_above', threshold: 85, sub_score: 'distribution_gap'}`)
- `delivery` text[]  (`['email','in_app']`)
- `enabled` boolean

**`alert_event`**
- `id` uuid pk
- `rule_id` uuid
- `entity_id` uuid
- `triggered_at` timestamptz
- `delivered` boolean
- `payload` jsonb

**`source_run`** — Health dashboard data.
- `id` uuid pk
- `source_id` text
- `started_at` timestamptz
- `finished_at` timestamptz
- `status` text (`ok` | `partial` | `error`)
- `items_ingested` int
- `error_message` text

### Drizzle migration workflow

- All schema lives in `/lib/db/schema.ts`.
- `pnpm db:generate` runs `drizzle-kit generate` to produce SQL.
- Generated SQL is committed under `/supabase/migrations/` and applied via `supabase db push` (or manually in the Supabase SQL editor for V1).
- Never write migrations by hand. Always go through Drizzle.

---

## 7. Ingestion jobs (Vercel cron)

Each source has a cron route under `/app/api/cron/[source]/route.ts`. All cron routes:

1. Verify the request came from Vercel Cron (`Authorization: Bearer ${CRON_SECRET}`).
2. Look up the source in the registry.
3. Bail out if the source is disabled.
4. Call `source.ingest()`.
5. Write a `source_run` row regardless of outcome.
6. Return JSON `{ok, itemsIngested, durationMs}`.

**`vercel.json` cron config:**

```json
{
  "crons": [
    { "path": "/api/cron/hackernews", "schedule": "*/30 * * * *" },
    { "path": "/api/cron/reddit", "schedule": "0 * * * *" },
    { "path": "/api/cron/producthunt", "schedule": "0 */6 * * *" },
    { "path": "/api/cron/github", "schedule": "0 8 * * *" },
    { "path": "/api/cron/apple-rss", "schedule": "0 9 * * *" },
    { "path": "/api/cron/x-twitter", "schedule": "0 */2 * * *" },
    { "path": "/api/cron/google-trends", "schedule": "0 10 * * *" },
    { "path": "/api/cron/indiehackers", "schedule": "0 */6 * * *" },
    { "path": "/api/cron/score-pending", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/compute-metrics", "schedule": "*/20 * * * *" },
    { "path": "/api/cron/run-alerts", "schedule": "*/30 * * * *" }
  ]
}
```

**Important:** Vercel's free/Hobby tier limits cron frequency. If we hit limits, Austin should upgrade to Pro, or we collapse routes (one cron that calls many sources sequentially).

### Entity resolution (the trickiest part)

When ingesting, every observation needs to either find an existing `entity` or create one. The resolver should match by, in order:

1. Exact `external_ids` match (e.g., `producthunt:12345`)
2. Exact domain match
3. Exact GitHub repo match
4. Fuzzy name match (Postgres `pg_trgm` similarity > 0.85) within same category
5. Otherwise: create new entity

The resolver lives in `/lib/ingest/resolver.ts` and is unit tested. Get this right early — it's the difference between a useful tool and chaos.

---

## 8. AI scoring + adjacency engine (the brain)

This is the most important piece of the product. It runs after metrics are computed for any entity that crosses an "interestingness threshold" (e.g., new entity with ≥10 mentions in 24h, OR existing entity whose momentum score jumped >20 points).

### Grok enrichment (pre-scoring step)

Before calling Claude, the scoring engine calls a Grok enrichment step in `/lib/scoring/grok-enricher.ts`:

1. **X post search** — Grok API searches X posts mentioning the entity name (last 7 days), returns top 5 relevant snippets
2. **Web search** — Grok API performs a web search for `"[entity name]" reviews OR launch OR feedback`, returns top 5 snippets

These snippets are passed into Claude's prompt as `additional_evidence`, clearly labeled by source. Grok **does not produce a score** — it is a research/enrichment tool only. Claude produces all sub-scores and reasoning.

If the Grok API call fails for any reason, the scoring engine continues with Claude using only the existing evidence (no score is skipped).

### Scoring prompt structure

The prompt is stored in `/lib/scoring/prompts/score-v1.ts` and **versioned**. Never edit a prompt in place — bump the version number so historical scores stay reproducible.

**Inputs to the prompt:**
- Entity name, description, URL, category
- Last 30 days of metrics (compact summary, not raw)
- Top 5 most relevant raw observations (HN thread excerpts, Reddit comments, PH tagline, GitHub README first paragraph)
- Known competitors (from co-mention analysis)

**Required structured output (use Anthropic's tool-use / structured output):**

```typescript
{
  total_score: number,           // 0-100
  sub_scores: {
    momentum: number,
    engagement_quality: number,
    distribution_gap: number,
    market_tailwinds: number,
    fundamentals: number,
    execution_feasibility: number,
  },
  reasoning: string,             // 3-5 sentence narrative
  red_flags: string[],           // anything that should make Austin skeptical
  evidence: Array<{
    source: string,
    url: string,
    snippet: string,
    signal_type: 'momentum' | 'engagement' | 'distribution_gap' | 'fundamentals'
  }>,
  adjacent_niches: Array<{
    niche: string,                  // e.g., "Legal teams"
    rationale: string,              // why this niche is underserved
    why_it_could_win: string,       // why the pattern transposes
    suggested_angle: string,        // a sharper positioning Austin could use
    estimated_difficulty: 'low' | 'medium' | 'high',
  }>,
  one_sentence_pitch: string,       // for the feed card
}
```

### Scoring philosophy in the prompt

The system prompt should bake in these instructions to Claude:
- Reward distribution gap heavily. A great product with bad marketing > a hot product everyone is already chasing.
- Penalize hype without depth. If engagement is shallow, say so.
- Be specific in adjacent niches. "Other industries" is not an answer. Name three concrete verticals.
- Never invent facts. If a field is missing, say "unknown" rather than fabricating.
- The reader (Austin) is a non-technical solo founder. Calibrate "execution feasibility" to that profile, not to a venture-backed team.

### Cost control

- Score at most ~50 entities per day in V1.
- Use `claude-sonnet-4-6` (not Opus) for routine scoring; reserve Opus for re-scoring user-saved opportunities or "deep dive" requests.
- Cache scores for 7 days unless metrics move materially.

---

## 9. App pages and UX

All pages use shadcn/ui components. Mobile-responsive but desktop-first (this is a work tool, not a consumer app).

### `/feed` — Opportunity feed (the home page)

- Top of page: filter bar (category, source, momentum window 7/14/30d, min score, "show only with adjacent niches")
- Main view: ranked card list. Each card shows:
  - Total score (big), sub-score sparkline
  - Entity name + one-sentence pitch
  - Source badges (PH, HN, Reddit, etc.)
  - Top adjacent niche (compact)
  - Quick actions: Save, Add to Pipeline, Hide
- Sort options: total score, momentum, distribution gap, freshness
- Default: distribution gap descending, last 14 days

### `/opportunities/[id]` — Opportunity detail

- Header: name, category, links, score
- Tabs:
  - **Overview** — full reasoning, evidence cards, red flags
  - **Adjacent niches** — full list, each with rationale + suggested angle. This is the money tab.
  - **Signals** — Recharts time series of every metric we track for this entity
  - **Raw evidence** — paginated list of observations with source links
  - **My notes** — markdown editor saved per user

### `/pipeline` — Kanban

- Columns: Inbox, Shortlist, Investigating, Building, Archived
- Drag and drop (use `@dnd-kit`)
- Click card → opens opportunity detail in a slide-over panel

### `/watchlists`

- List of watchlists; each is a saved filter + optional pinned entities
- Watchlist detail page reuses the feed component with the saved filter applied

### `/sources` — Source health dashboard

- Table of all sources with: enabled toggle, last run, status, items ingested in last 24h, current rate-limit headroom
- Manual "run now" button per source (writes a `source_run` row)
- This page is what saves Austin's sanity when something breaks

### `/settings`

- Profile (just email for V1)
- API keys for sources (Reddit, PH, GitHub PAT, Anthropic key)
- Notification preferences (email digest on/off, daily/weekly)
- Export: download all opportunities as CSV

### Auth pages

- `/login` — magic link only for V1
- `/signup` — same form, magic link

---

## 10. API routes (REST, internal)

All routes require auth except `/api/cron/*` (which use `CRON_SECRET`).

```
GET    /api/opportunities                   query: filters, sort, page
GET    /api/opportunities/:id
GET    /api/opportunities/:id/timeseries    query: metric, window
POST   /api/opportunities/:id/save
POST   /api/opportunities/:id/pipeline      body: {stage}
DELETE /api/opportunities/:id/pipeline

GET    /api/watchlists
POST   /api/watchlists
PATCH  /api/watchlists/:id
DELETE /api/watchlists/:id

GET    /api/alerts/rules
POST   /api/alerts/rules
PATCH  /api/alerts/rules/:id
DELETE /api/alerts/rules/:id

GET    /api/sources
POST   /api/sources/:id/run                 manual trigger

GET    /api/exports/opportunities.csv

POST   /api/cron/[source]                   internal, cron-secret protected
```

Prefer Next.js server actions for mutations originating from the UI. Use REST routes for anything that needs to be called from outside the UI (cron, future webhooks, future CLI).

---

## 11. Auth and multi-tenancy

- Supabase Auth with magic-link email login for V1.
- Every user-scoped table has `user_id` and an RLS policy: `user_id = auth.uid()`.
- The `entity`, `raw_observation`, `metric_timeseries`, and `score_snapshot` tables are **shared across users** (they're public market data). RLS allows read for any authenticated user but write only for the service role.
- User-specific data (watchlists, pipeline items, alert rules, notes) is fully isolated.
- For V1, only Austin's email is allowed to sign up. Implement an `allowed_emails` table or env var allowlist; reject any other signup attempt.

---

## 12. Environment variables

Create `.env.example` with this exact list. Austin will fill in real values in Vercel + `.env.local`.

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Database (for Drizzle direct connection)
DATABASE_URL=

# Anthropic (primary AI scorer)
ANTHROPIC_API_KEY=

# Source: X / Twitter (pay-as-you-go Bearer Token)
X_API_BEARER_TOKEN=

# Scoring enrichment: Grok (xAI) — X post search + web search
XAI_API_KEY=

# Source: Reddit (public JSON — no credentials needed, just set User-Agent in code)
# No env vars required for Reddit

# Source: Product Hunt
PRODUCT_HUNT_API_TOKEN=

# Source: GitHub
GITHUB_PERSONAL_ACCESS_TOKEN=

# Source: Google Trends (unofficial npm package — no API key needed)
# No env vars required for Google Trends

# Cron
CRON_SECRET=

# Allowlist
ALLOWED_SIGNUP_EMAILS=aadavidson95@gmail.com

# Sentry
SENTRY_DSN=
```

---

## 13. Infra decisions made during build (override any conflicting assumptions above)

| Topic | Decision | Reason |
|---|---|---|
| Cron scheduling | **cron-job.com** (not Vercel cron) | Vercel Hobby plan only allows 1 daily cron; cron-job.com is free and sends custom headers |
| DATABASE_URL | **Transaction Pooler** port 6543 | Designed for serverless; direct connection (port 5432) exhausts Supabase connection limits |
| Supabase redirect URLs | Must be whitelisted in Supabase → Auth → URL Configuration | Magic link breaks silently if production domain isn't in the allowlist |
| Product Hunt API | Austin has client ID (`PRODUCT_HUNT_API_KEY`) + secret (`PRODUCT_HUNT_API_SECRET`) | PH connector must do OAuth2 client_credentials exchange to get bearer token at runtime |
| X extra keys | `X_SECRET_KEY` + `X_CONSUMER_KEY` exist in env | OAuth 1.0a keys from X app registration; not needed for Bearer Token search in V1 |
| Vercel function timeout | Export `maxDuration = 10` on all cron routes | Hobby plan hard limit is 10s; ingest functions must budget time and stop gracefully |

---

## 14. Phased roadmap

**Don't try to build everything at once.** Build in this order. Each phase should be deployed to Vercel and used by Austin before starting the next.

### Phase 0 — Project setup ✅ COMPLETE (2026-04-08)

- `pnpm create next-app` with TypeScript, Tailwind, App Router
- Install: drizzle-orm, postgres, @anthropic-ai/sdk, @supabase/supabase-js, @supabase/ssr, zod, shadcn/ui
- Configure Tailwind + shadcn
- Set up Supabase project (Austin will create it)
- Wire up Drizzle, generate first migration with `users` access via auth and the core tables
- Configure Sentry
- Deploy a "hello world" page to Vercel
- Verify auth flow works end-to-end (magic link → protected page)

### Phase 1 — Ingest one source, end-to-end ✅ COMPLETE (2026-04-08)

- Implement the source registry pattern
- Implement only the **Hacker News** connector (it's the simplest and most signal-dense)
- Implement entity resolver with the 5-step matching logic
- Set up the cron route + `source_run` logging
- Build the `/sources` health page so Austin can see it working
- **Acceptance:** every 30 minutes, new HN Show HN posts appear as `entity` rows. No errors. Source health page shows green.

### Phase 2 — AI scoring + minimal feed (Days 5–8) ← NEXT

- Implement metric computation cron (just `mentions_24h` and `hn_score` for now)
- Implement the scoring engine with the v1 prompt
- Implement `/api/cron/score-pending` that scores any entity that crossed the threshold
- Build a bare-bones `/feed` page that lists scored opportunities sorted by total score
- Build `/opportunities/[id]` with the Overview and Adjacent Niches tabs
- **Acceptance:** Austin can open the app, see a ranked list, click into an item, and read a useful "why this + adjacent niches" explanation. This is the moment we know the product works.

### Phase 3 — Add the rest of the sources (Days 9–13)

- Reddit connector (public JSON, no OAuth required)
- Product Hunt connector
- GitHub trending connector
- Apple RSS connector
- X / Twitter connector (pay-as-you-go search; start disabled, enable after manual test)
- Indie Hackers connector
- Google Trends connector (unofficial npm; start disabled, non-blocking on failure)
- Each connector ships with a `source_run` entry visible on `/sources`
- **Acceptance:** all enabled sources run on schedule for 48 hours without rate-limit errors.

### Phase 4 — Workflow features (Days 14–18)

- Pipeline kanban with drag and drop
- Watchlists with saved filters
- Notes per opportunity (markdown)
- Save / hide actions on feed cards
- CSV export
- **Acceptance:** Austin uses the pipeline to track 3 real opportunities through the stages.

### Phase 5 — Alerts + polish (Days 19–22)

- Alert rules engine (simple threshold conditions only)
- Daily email digest of new top opportunities (Resend or Supabase email)
- In-app notification badge
- All Signals tab on opportunity detail with Recharts
- Onboarding tour for first-time use
- **Acceptance:** Austin gets a useful daily email and rarely needs to manually open the app to find the day's best opportunities.

### Phase 6 — Multi-user prep (only when Austin says go)

- Remove the email allowlist restriction or expand it
- Add a billing layer (Stripe) — separate task
- Add usage quotas per user
- Add team sharing if requested

---

## 14. What is explicitly **out of scope** for V1

If a request doesn't match what's in this doc, push back before building it. Specifically out of scope:

- Team collaboration / multi-user workspaces
- Billing / Stripe / subscription management
- SSO, RBAC, admin panels
- Mobile apps (responsive web is enough)
- Real-time websockets (polling on interval is fine)
- Custom ML models, vector search, embeddings — Claude API does the heavy lifting
- Slack integration (deferred to phase 5+)
- CRM / Notion / Jira integrations (deferred indefinitely)
- Public landing page / marketing site (Austin will handle separately)

---

## 15. Quality bars

Before any phase is considered done:

1. **Type safety:** zero `any` types. Zod schemas at every external boundary.
2. **No raw SQL strings.** Always use Drizzle.
3. **All async functions handle errors.** No unhandled promise rejections.
4. **Every cron route logs to `source_run`.** No silent failures.
5. **Every external API call respects its rate limit** with token bucket or simple sleep.
6. **Secrets never logged.** Sentry scrubbing configured.
7. **The build passes** (`pnpm build`) and `pnpm typecheck` is clean.
8. **The app works in production on Vercel**, not just locally.

---

## 16. Things Claude Code should ask Austin about before starting

These are deliberately unresolved. Don't guess — ask.

1. **Supabase project:** Has Austin already created the Supabase project, or does Claude Code need to walk him through it? Need URL and keys before any DB work.
2. **Vercel project:** Same question. Vercel project needs to exist and be linked to the GitHub repo before cron can be configured.
3. **API tokens for sources:** Product Hunt developer app, GitHub PAT, X API Bearer Token, xAI (Grok) API key. Reddit requires no credentials. Provide step-by-step instructions when needed.
4. **Anthropic API key:** Confirm Austin has one with usage budget set.
5. **xAI / Grok API key:** Confirm key is available for scoring enrichment.
6. **X API Bearer Token:** Confirm pay-as-you-go access is active.
5. **Domain:** Is there a custom domain, or just `*.vercel.app` for now?
6. **Email sending:** Resend, Postmark, or use Supabase's built-in email for magic links + digests?
7. **Sentry:** Does Austin want to set this up now or defer to phase 5?

---

## 17. How Claude Code should work in this repo

- Always read this file first when starting a new session.
- Always work on a feature branch, never commit directly to `main`.
- Always run `pnpm typecheck` and `pnpm build` before declaring a task done.
- Always update this doc when a decision changes — this file is the source of truth.
- When in doubt about scope, prefer shipping the smallest thing that proves the next idea, then iterate.
- Never invent a third-party API or library function. If you're not sure it exists, check the docs first.
- Never store secrets in code. Use env vars.
- Never disable RLS without a written reason in the migration comments.

---

## 18. Definition of "done" for V1 (the bar Austin cares about)

V1 is done when Austin can:

1. Open `https://buildwut.vercel.app`, log in with a magic link.
2. See a ranked feed of 20–50 fresh opportunities updated within the last 24 hours.
3. Click any opportunity and read a Claude-generated explanation that includes (a) why it scored high, (b) what the red flags are, and (c) **at least three concrete adjacent niches** with sharp angles he could actually pursue.
4. Drag opportunities into a pipeline and add notes.
5. Get a daily email digest of new top opportunities.
6. Trust the scores enough to act on at least one of them per week.

If we hit those six things, V1 is a success and we expand.

---

*End of plan. When in doubt, re-read sections 2 (principles) and 18 (definition of done).*
