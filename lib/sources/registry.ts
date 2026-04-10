export type IngestResult = {
  ok: boolean
  itemsIngested: number
  errors: string[]
}

export interface SourceDefinition {
  id: string
  name: string
  enabled: boolean
  cadenceCron: string
  rateLimit: { requests: number; perSeconds: number }
  licensingState: 'free' | 'personal-only' | 'licensed' | 'restricted'
  ingest: () => Promise<IngestResult>
}

// Lazy imports to avoid loading DB/fetch dependencies at registry import time in test/build
import { run as runHackerNews } from '@/lib/ingest/hn'
import { run as runReddit } from '@/lib/ingest/reddit'
import { run as runIndieHackers } from '@/lib/ingest/indiehackers'
import { run as runAppleRss } from '@/lib/ingest/apple-rss'
import { run as runGithub } from '@/lib/ingest/github'
import { run as runProductHunt } from '@/lib/ingest/producthunt'
import { run as runXTwitter } from '@/lib/ingest/x-twitter'
import { run as runGoogleTrends } from '@/lib/ingest/google-trends'

const sources: SourceDefinition[] = [
  {
    id: 'hackernews',
    name: 'Hacker News',
    enabled: true,
    cadenceCron: '*/30 * * * *',
    rateLimit: { requests: 60, perSeconds: 60 },
    licensingState: 'free',
    ingest: runHackerNews,
  },
  {
    id: 'reddit',
    name: 'Reddit',
    enabled: false, // Disabled: Vercel IPs blocked by Reddit as of 2026. See CLAUDE.md for re-enable options.
    cadenceCron: '0 * * * *',
    rateLimit: { requests: 60, perSeconds: 60 },
    licensingState: 'free',
    ingest: runReddit,
  },
  {
    id: 'indiehackers',
    name: 'Indie Hackers',
    enabled: true,
    cadenceCron: '0 */6 * * *',
    rateLimit: { requests: 60, perSeconds: 60 },
    licensingState: 'free',
    ingest: runIndieHackers,
  },
  {
    id: 'apple-rss',
    name: 'Apple App Store RSS',
    enabled: true,
    cadenceCron: '0 9 * * *',
    rateLimit: { requests: 100, perSeconds: 3600 },
    licensingState: 'free',
    ingest: runAppleRss,
  },
  {
    id: 'github',
    name: 'GitHub Trending',
    enabled: true,
    cadenceCron: '0 8 * * *',
    rateLimit: { requests: 5000, perSeconds: 3600 },
    licensingState: 'free',
    ingest: runGithub,
  },
  {
    id: 'producthunt',
    name: 'Product Hunt',
    enabled: true,
    cadenceCron: '0 */6 * * *',
    rateLimit: { requests: 100, perSeconds: 900 },
    licensingState: 'personal-only',
    ingest: runProductHunt,
  },
  {
    id: 'x-twitter',
    name: 'X / Twitter',
    enabled: true,
    cadenceCron: '0 */2 * * *',
    rateLimit: { requests: 500000, perSeconds: 2592000 },
    licensingState: 'licensed',
    ingest: runXTwitter,
  },
  {
    id: 'google-trends',
    name: 'Google Trends',
    enabled: true,
    cadenceCron: '0 10 * * *',
    rateLimit: { requests: 10, perSeconds: 60 },
    licensingState: 'restricted',
    ingest: runGoogleTrends,
  },
]

export function getSource(id: string): SourceDefinition | undefined {
  return sources.find((s) => s.id === id)
}

export function getAllSources(): SourceDefinition[] {
  return sources
}
