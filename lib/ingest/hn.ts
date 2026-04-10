import { db } from '@/lib/db'
import { rawObservation } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { resolveEntity } from './resolver'
import type { IngestResult } from '@/lib/sources/registry'

const HN_BASE = 'https://hacker-news.firebaseio.com/v0'
// Keep batch small so the function finishes well within Vercel's 10s limit.
// Every 30 min only a handful of new stories appear anyway; on the first-ever
// run we'll just catch up over a few executions.
const MAX_IDS_PER_ENDPOINT = 30
const CONCURRENT_ITEM_FETCHES = 5
// Stop processing new items 2 seconds before the hard deadline
const TIME_BUDGET_MS = 8_000

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

async function processItem(id: number, errors: string[]): Promise<boolean> {
  try {
    const item = await fetchItem(id)
    if (!item || item.deleted || item.dead || item.type !== 'story' || !item.title) {
      return false
    }

    const isShowHn = /^show hn:/i.test(item.title)
    const entityName = isShowHn ? item.title.replace(/^show hn:\s*/i, '').trim() : item.title

    // Only create/resolve entities for Show HN posts (actual product launches).
    // Regular stories are stored as raw observations with null entityId — they
    // won't become feed entries or get scored, but remain available as signal data.
    let entityId: string | null = null
    if (isShowHn) {
      try {
        entityId = await resolveEntity({
          name: entityName,
          url: item.url,
          externalIds: { hackernews: String(item.id) },
        })
      } catch (resolveErr) {
        errors.push(`resolve failed for HN ${id}: ${String(resolveErr)}`)
      }
    }

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

    return true
  } catch (err) {
    errors.push(`failed to process HN item ${id}: ${String(err)}`)
    return false
  }
}

export async function run(): Promise<IngestResult> {
  const startedAt = Date.now()
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

  // 2. Find which IDs we haven't ingested yet
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

  // 3. Process in concurrent batches, stopping if we approach the time budget
  for (let i = 0; i < unprocessed.length; i += CONCURRENT_ITEM_FETCHES) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      errors.push(`time budget reached after ${itemsIngested} items; remaining will be caught on next run`)
      break
    }

    const batch = unprocessed.slice(i, i + CONCURRENT_ITEM_FETCHES)
    const results = await Promise.all(batch.map((id) => processItem(id, errors)))
    itemsIngested += results.filter(Boolean).length
  }

  return {
    ok: errors.length === 0,
    itemsIngested,
    errors,
  }
}
