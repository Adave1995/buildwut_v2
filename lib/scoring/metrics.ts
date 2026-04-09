import { db } from '@/lib/db'
import { rawObservation, metricTimeseries } from '@/lib/db/schema'
import { gte, isNotNull, and } from 'drizzle-orm'

export type MetricsResult = {
  entityCount: number
  metricsWritten: number
}

/**
 * For every entity that has at least one raw_observation in the last 24 hours,
 * compute `mentions_24h` (observation count) and `hn_score` (max HN score seen)
 * and append a row to metric_timeseries.
 */
export async function computeMetrics(): Promise<MetricsResult> {
  const now = new Date()
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  const recentObs = await db
    .select({
      entityId: rawObservation.entityId,
      sourceId: rawObservation.sourceId,
      payload: rawObservation.payload,
    })
    .from(rawObservation)
    .where(
      and(
        isNotNull(rawObservation.entityId),
        gte(rawObservation.observedAt, since24h)
      )
    )

  // Aggregate per entity
  const entityMap = new Map<string, { mentions: number; hnScore: number }>()

  for (const obs of recentObs) {
    if (!obs.entityId) continue
    const cur = entityMap.get(obs.entityId) ?? { mentions: 0, hnScore: 0 }
    cur.mentions += 1
    if (obs.sourceId === 'hackernews') {
      const rawScore = (obs.payload as Record<string, unknown>).score
      if (typeof rawScore === 'number') {
        cur.hnScore = Math.max(cur.hnScore, rawScore)
      }
    }
    entityMap.set(obs.entityId, cur)
  }

  if (entityMap.size === 0) {
    return { entityCount: 0, metricsWritten: 0 }
  }

  const rows: Array<typeof metricTimeseries.$inferInsert> = []

  for (const [entityId, { mentions, hnScore }] of entityMap) {
    rows.push(
      { entityId, metricName: 'mentions_24h', t: now, value: String(mentions) },
      { entityId, metricName: 'hn_score', t: now, value: String(hnScore) }
    )
  }

  await db.insert(metricTimeseries).values(rows)

  return { entityCount: entityMap.size, metricsWritten: rows.length }
}
