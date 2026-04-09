import { db } from '@/lib/db'
import { rawObservation } from '@/lib/db/schema'
import { interestOverTime } from 'google-trends-api'
import type { IngestResult } from '@/lib/sources/registry'

// Keywords representative of the opportunity radar's focus areas
const KEYWORDS = ['saas', 'indie hacker', 'side project', 'app launch', 'build in public']

type TimelinePoint = {
  time: string
  formattedTime: string
  value: number[]
  hasData: boolean[]
}

type TrendsPayload = {
  default: {
    timelineData: TimelinePoint[]
  }
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function run(): Promise<IngestResult> {
  const errors: string[] = []
  let itemsIngested = 0
  const today = todayString()

  const startTime = new Date()
  startTime.setDate(startTime.getDate() - 7)

  for (const keyword of KEYWORDS) {
    try {
      const raw = await interestOverTime({ keyword, startTime, geo: 'US' })
      const parsed = JSON.parse(raw) as TrendsPayload
      const timeline = parsed.default?.timelineData ?? []
      const latest = timeline[timeline.length - 1]
      if (!latest) continue

      await db
        .insert(rawObservation)
        .values({
          entityId: null,
          sourceId: 'google-trends',
          sourceEventId: `${keyword}:${today}`,
          eventType: 'rank_snapshot',
          payload: {
            keyword,
            interest_value: latest.value[0] ?? 0,
            formatted_time: latest.formattedTime,
            timeline_points: timeline.length,
          },
          observedAt: new Date(),
        })
        .onConflictDoNothing()

      itemsIngested++
    } catch (err) {
      // Google Trends is non-blocking — log partial and continue
      errors.push(`trend "${keyword}": ${String(err)}`)
    }
  }

  // Partial success is ok for Google Trends
  return {
    ok: itemsIngested > 0 || errors.length === 0,
    itemsIngested,
    errors,
  }
}
