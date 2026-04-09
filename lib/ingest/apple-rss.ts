import { db } from '@/lib/db'
import { rawObservation } from '@/lib/db/schema'
import { resolveEntity } from './resolver'
import type { IngestResult } from '@/lib/sources/registry'

type AppleApp = {
  artistName: string
  id: string
  name: string
  artworkUrl100: string
  url: string
  releaseDate: string
  genres: Array<{ genreId: string; name: string }>
}

type AppleFeedResponse = {
  feed: {
    results: AppleApp[]
  }
}

const FEEDS: Array<{ url: string; feedType: string }> = [
  {
    url: 'https://rss.applemarketingtools.com/api/v2/us/apps/top-free/25/apps.json',
    feedType: 'top-free',
  },
  {
    url: 'https://rss.applemarketingtools.com/api/v2/us/apps/top-paid/25/apps.json',
    feedType: 'top-paid',
  },
]

function todayString(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function run(): Promise<IngestResult> {
  const errors: string[] = []
  let itemsIngested = 0
  const today = todayString()

  for (const feed of FEEDS) {
    let apps: AppleApp[]
    try {
      const res = await fetch(feed.url, {
        headers: { 'User-Agent': 'buildwut/0.1 (personal tool)' },
        next: { revalidate: 0 },
      })
      if (!res.ok) throw new Error(`Apple RSS ${feed.feedType} returned ${res.status}`)
      const json = (await res.json()) as AppleFeedResponse
      apps = json.feed.results
    } catch (err) {
      errors.push(`${feed.feedType}: ${String(err)}`)
      continue
    }

    for (let rank = 0; rank < apps.length; rank++) {
      const app = apps[rank]
      try {
        let entityId: string | null = null
        try {
          entityId = await resolveEntity({
            name: app.name,
            url: app.url,
            description: `iOS app by ${app.artistName}`,
            category: app.genres[0]?.name,
            externalIds: { apple: app.id },
          })
        } catch (resolveErr) {
          errors.push(`resolve apple ${app.id}: ${String(resolveErr)}`)
        }

        await db
          .insert(rawObservation)
          .values({
            entityId,
            sourceId: 'apple-rss',
            sourceEventId: `${app.id}:${feed.feedType}:${today}`,
            eventType: 'rank_snapshot',
            payload: {
              app_id: app.id,
              name: app.name,
              artist: app.artistName,
              url: app.url,
              rank: rank + 1,
              feed_type: feed.feedType,
              genre: app.genres[0]?.name ?? null,
            },
            observedAt: new Date(),
          })
          .onConflictDoNothing()

        itemsIngested++
      } catch (err) {
        errors.push(`apple ${app.id}: ${String(err)}`)
      }
    }
  }

  return { ok: errors.length === 0, itemsIngested, errors }
}
