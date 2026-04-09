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

// Lazy import to avoid loading DB/fetch dependencies at registry import time in test/build
import { run as runHackerNews } from '@/lib/ingest/hn'

const notImplemented = async (): Promise<IngestResult> => ({
  ok: false,
  itemsIngested: 0,
  errors: ['Not implemented'],
})

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
    enabled: false,
    cadenceCron: '0 * * * *',
    rateLimit: { requests: 60, perSeconds: 60 },
    licensingState: 'free',
    ingest: notImplemented,
  },
  {
    id: 'producthunt',
    name: 'Product Hunt',
    enabled: false,
    cadenceCron: '0 */6 * * *',
    rateLimit: { requests: 100, perSeconds: 900 },
    licensingState: 'personal-only',
    ingest: notImplemented,
  },
  {
    id: 'github',
    name: 'GitHub Trending',
    enabled: false,
    cadenceCron: '0 8 * * *',
    rateLimit: { requests: 5000, perSeconds: 3600 },
    licensingState: 'free',
    ingest: notImplemented,
  },
  {
    id: 'apple-rss',
    name: 'Apple App Store RSS',
    enabled: false,
    cadenceCron: '0 9 * * *',
    rateLimit: { requests: 100, perSeconds: 3600 },
    licensingState: 'free',
    ingest: notImplemented,
  },
  {
    id: 'x-twitter',
    name: 'X / Twitter',
    enabled: false,
    cadenceCron: '0 */2 * * *',
    rateLimit: { requests: 500000, perSeconds: 2592000 },
    licensingState: 'licensed',
    ingest: notImplemented,
  },
  {
    id: 'google-trends',
    name: 'Google Trends',
    enabled: false,
    cadenceCron: '0 10 * * *',
    rateLimit: { requests: 10, perSeconds: 60 },
    licensingState: 'restricted',
    ingest: notImplemented,
  },
  {
    id: 'indiehackers',
    name: 'Indie Hackers',
    enabled: false,
    cadenceCron: '0 */6 * * *',
    rateLimit: { requests: 60, perSeconds: 60 },
    licensingState: 'free',
    ingest: notImplemented,
  },
]

export function getSource(id: string): SourceDefinition | undefined {
  return sources.find((s) => s.id === id)
}

export function getAllSources(): SourceDefinition[] {
  return sources
}
