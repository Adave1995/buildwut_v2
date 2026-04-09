import { db } from '@/lib/db'
import { rawObservation } from '@/lib/db/schema'
import { resolveEntity } from './resolver'
import type { IngestResult } from '@/lib/sources/registry'

const IH_RSS_URL = 'https://www.indiehackers.com/feed.xml'

type RssItem = {
  title: string
  link: string
  description: string
  pubDate: string
  guid: string
}

function extractCdataOrText(xml: string, tag: string): string {
  const re = new RegExp(
    `<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`,
    'i'
  )
  const m = xml.match(re)
  if (!m) return ''
  return (m[1] ?? m[2] ?? '').trim()
}

function parseItems(xml: string): RssItem[] {
  const items: RssItem[] = []
  const itemRe = /<item>([\s\S]*?)<\/item>/g
  let match: RegExpExecArray | null
  while ((match = itemRe.exec(xml)) !== null) {
    const body = match[1]
    const title = extractCdataOrText(body, 'title')
    const link = extractCdataOrText(body, 'link')
    const description = extractCdataOrText(body, 'description')
    const pubDate = extractCdataOrText(body, 'pubDate')
    const guid = extractCdataOrText(body, 'guid')
    if (title && (link || guid)) {
      items.push({
        title,
        link: link || guid,
        description,
        pubDate,
        guid: guid || link,
      })
    }
  }
  return items
}

export async function run(): Promise<IngestResult> {
  const errors: string[] = []
  let itemsIngested = 0

  let xml: string
  try {
    const res = await fetch(IH_RSS_URL, {
      headers: { 'User-Agent': 'buildwut/0.1 (personal tool)' },
      next: { revalidate: 0 },
    })
    if (!res.ok) throw new Error(`IH RSS returned ${res.status}`)
    xml = await res.text()
  } catch (err) {
    return { ok: false, itemsIngested: 0, errors: [String(err)] }
  }

  const items = parseItems(xml)
  if (items.length === 0) {
    return { ok: true, itemsIngested: 0, errors: [] }
  }

  for (const item of items) {
    try {
      let entityId: string | null = null
      try {
        entityId = await resolveEntity({
          name: item.title,
          url: item.link,
          externalIds: { indiehackers: item.guid },
        })
      } catch (resolveErr) {
        errors.push(`resolve ${item.guid}: ${String(resolveErr)}`)
      }

      const parsedDate = item.pubDate ? new Date(item.pubDate) : new Date()
      const observedAt = isNaN(parsedDate.getTime()) ? new Date() : parsedDate

      await db
        .insert(rawObservation)
        .values({
          entityId,
          sourceId: 'indiehackers',
          sourceEventId: item.guid,
          eventType: 'mention',
          payload: {
            title: item.title,
            url: item.link,
            description: item.description.slice(0, 500),
          },
          observedAt,
        })
        .onConflictDoNothing()

      itemsIngested++
    } catch (err) {
      errors.push(`IH item ${item.guid}: ${String(err)}`)
    }
  }

  return { ok: errors.length === 0, itemsIngested, errors }
}
