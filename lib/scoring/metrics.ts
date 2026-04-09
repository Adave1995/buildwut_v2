import { db } from '@/lib/db'
import { metricTimeseries } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'

export type MetricsResult = {
  entityCount: number
  metricsWritten: number
}

/**
 * For every entity with raw_observations in the last 24 hours, compute:
 *   - mentions_24h: total observation count
 *   - hn_score: max HN score seen
 *
 * Aggregation happens in Postgres (GROUP BY) so we only return one row per
 * entity — avoids pulling thousands of rows into JS.
 */
export async function computeMetrics(): Promise<MetricsResult> {
  const now = new Date()

  type AggRow = { entity_id: string; mentions: string; hn_score: string }

  const rows = await db.execute<AggRow>(sql`
    SELECT
      entity_id,
      COUNT(*) AS mentions,
      COALESCE(
        MAX(
          CASE WHEN source_id = 'hackernews'
            THEN (payload->>'score')::numeric
            ELSE 0
          END
        ), 0
      ) AS hn_score
    FROM raw_observation
    WHERE entity_id IS NOT NULL
      AND observed_at >= NOW() - INTERVAL '24 hours'
    GROUP BY entity_id
  `)

  if (rows.length === 0) {
    return { entityCount: 0, metricsWritten: 0 }
  }

  const inserts: Array<typeof metricTimeseries.$inferInsert> = []
  for (const row of rows) {
    inserts.push(
      { entityId: row.entity_id, metricName: 'mentions_24h', t: now, value: row.mentions },
      { entityId: row.entity_id, metricName: 'hn_score',     t: now, value: row.hn_score }
    )
  }

  await db.insert(metricTimeseries).values(inserts)

  return { entityCount: rows.length, metricsWritten: inserts.length }
}
