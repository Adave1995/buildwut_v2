import { db } from '@/lib/db'
import { rawObservation } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { resolveEntity } from './resolver'
import type { IngestResult } from '@/lib/sources/registry'

const HN_BASE = 'https://hacker-news.firebaseio.com/v0'
const MAX_IDS_PER_ENDPOINT = 100
const ITEM_FETCH_DELAY_MS = 50

type HnItem = {
  id: number
  type: string
  title?: string
  url?: string
  score?: number
  by?: string
  time: number
  descendants?: number
  deleted?: boolean
  dead?: boolean
}

async function fetchIdList(endpoint: string): Promise<number[]> {
  const res = await fetch(`${HN_BASE}/${endpoint}.json`, {
    headers: { 'User-Agent': 'buildwut/0.1 (personal tool)' },
    next: { revalidate: 0 },
  })
  if (!res.ok) throw new Error(`HN ${endpoint} returned ${res.status}`)
  const ids: number[] = await res.json()
  return ids.slice(0, MAX_IDS_PER_ENDPOINT)
}

async function fetchItem(id: number): Promise<HnItem | null> {
  const res = await fetch(`${HN_BASE}/item/${id}.json`, {
    headers: { 'User-Agent': 'buildwut/0.1 (personal tool)' },
    next: { revalidate: 0 },
  })
  if (!res.ok) return null
  return res.json() as Promise<HnItem>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function run(): Promise<IngestResult> {
  const errors: string[] = []
  let itemsIngested = 0

  // 1. Fetch IDs from both endpoints in parallel
  let topIds: number[] = []
  let newIds: number[] = []
  try {
    ;[topIds, newIds] = await Promise.all([
      fetchIdList('topstories'),
      fetchIdList('newstories'),
    ])
  } catch (err) {
    return { ok: false, itemsIngested: 0, errors: [String(err)] }
  }

  const allIds = [...new Set([...topIds, ...newIds])]
  if (allIds.length === 0) {
    return { ok: true, itemsIngested: 0, errors: [] }
  }

  // 2. Find which IDs we haven't ingested yet (avoids re-fetching items)
  const allIdStrings = allIds.map(String)
  const existing = await db
    .select({ sourceEventId: rawObservation.sourceEventId })
    .from(rawObservation)
    .where(
      and(
        eq(rawObservation.sourceId, 'hackernews'),
        inArray(rawObservation.sourceEventId, allIdStrings)
      )
    )

  const existingSet = new Set(existing.map((r) => r.sourceEventId))
  const unprocessed = allIds.filter((id) => !existingSet.has(String(id)))

  // 3. Fetch and ingest each new item
  for (const id of unprocessed) {
    try {
      await sleep(ITEM_FETCH_DELAY_MS)

      const item = await fetchItem(id)
      if (!item || item.deleted || item.dead || item.type !== 'story' || !item.title) {
        continue
      }

      const isShowHn = /^show hn:/i.test(item.title)
      const entityName = isShowHn ? item.title.replace(/^show hn:\s*/i, '').trim() : item.title

      // Resolve or create entity; only bother if there's a URL or it's a Show HN
      let entityId: string | null = null
      if (item.url || isShowHn) {
        try {
          entityId = await resolveEntity({
            name: entityName,
            url: item.url,
            externalIds: { hackernews: String(item.id) },
          })
        } catch (resolveErr) {
          errors.push(`resolve failed for HN ${id}: ${String(resolveErr)}`)
          // Continue — we'll still write the observation with null entity_id
        }
      }

      // Write observation (ON CONFLICT DO NOTHING — safe for concurrent runs)
      await db
        .insert(rawObservation)
        .values({
          entityId,
          sourceId: 'hackernews',
          sourceEventId: String(item.id),
          eventType: isShowHn ? 'launch' : 'mention',
          payload: {
            hn_id: item.id,
            title: item.title,
            url: item.url ?? null,
            score: item.score ?? 0,
            author: item.by ?? null,
            comments_count: item.descendants ?? 0,
            is_show_hn: isShowHn,
          },
          observedAt: new Date(item.time * 1000),
        })
        .onConflictDoNothing()

      itemsIngested++
    } catch (err) {
      errors.push(`failed to process HN item ${id}: ${String(err)}`)
    }
  }

  return {
    ok: errors.length === 0,
    itemsIngested,
    errors,
  }
}
