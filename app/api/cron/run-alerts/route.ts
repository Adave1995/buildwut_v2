import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logger } from '@/lib/logger'
import {
  alertRule,
  alertEvent,
  entity,
  metricTimeseries,
  sourceRun,
} from '@/lib/db/schema'
import { eq, and, gte, desc, inArray, sql } from 'drizzle-orm'

export const maxDuration = 30

async function getLatestScores() {
  // Get the most recent score_snapshot per entity using a lateral join
  type Row = {
    entity_id: string
    total_score: number
    momentum_score: number
    engagement_quality_score: number
    distribution_gap_score: number
    market_tailwinds_score: number
    fundamentals_score: number
    execution_feasibility_score: number
    as_of: Date
  }
  const rows = await db.execute<Row>(sql`
    SELECT DISTINCT ON (entity_id)
      entity_id, total_score, momentum_score, engagement_quality_score,
      distribution_gap_score, market_tailwinds_score, fundamentals_score,
      execution_feasibility_score, as_of
    FROM score_snapshot
    ORDER BY entity_id, as_of DESC
  `)
  return rows
}

function getSubScore(
  row: {
    total_score: number
    momentum_score: number
    engagement_quality_score: number
    distribution_gap_score: number
    market_tailwinds_score: number
    fundamentals_score: number
    execution_feasibility_score: number
  },
  subScoreName: string | undefined
): number {
  if (!subScoreName) return row.total_score
  const map: Record<string, number> = {
    momentum: row.momentum_score,
    engagement_quality: row.engagement_quality_score,
    distribution_gap: row.distribution_gap_score,
    market_tailwinds: row.market_tailwinds_score,
    fundamentals: row.fundamentals_score,
    execution_feasibility: row.execution_feasibility_score,
  }
  return map[subScoreName] ?? row.total_score
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = new Date()
  const startMs = Date.now()
  let totalFired = 0
  const log = logger.child({ cron: 'run-alerts' })

  try {
    // Load all enabled alert rules
    const rules = await db.select().from(alertRule).where(eq(alertRule.enabled, true))
    log.info({ ruleCount: rules.length }, 'evaluating alert rules')

    if (rules.length === 0) {
      await writeSourceRun(startedAt, 'ok', 0, null)
      return NextResponse.json({ ok: true, fired: 0 })
    }

    // Load data we need for evaluation
    const latestScores = await getLatestScores()
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

    // New entities in last 24h
    const newEntities = await db
      .select({ id: entity.id })
      .from(entity)
      .where(gte(entity.firstSeenAt!, twentyFourHoursAgo))

    // Momentum spikes: entities where mentions_24h >= threshold in last 24h
    const mentionRows = await db
      .select({ entityId: metricTimeseries.entityId, value: metricTimeseries.value })
      .from(metricTimeseries)
      .where(
        and(
          eq(metricTimeseries.metricName, 'mentions_24h'),
          gte(metricTimeseries.t, twentyFourHoursAgo)
        )
      )
      .orderBy(desc(metricTimeseries.value))

    // Deduplicate mention rows to latest value per entity
    const mentionByEntity = new Map<string, number>()
    for (const row of mentionRows) {
      if (!mentionByEntity.has(row.entityId)) {
        mentionByEntity.set(row.entityId, Number(row.value))
      }
    }

    for (const rule of rules) {
      const condition = rule.condition
      let matchedEntityIds: string[] = []

      if (condition.type === 'score_above') {
        const threshold = condition.threshold ?? 70
        matchedEntityIds = latestScores
          .filter((s) => getSubScore(s, condition.sub_score) >= threshold)
          .map((s) => s.entity_id)
      } else if (condition.type === 'score_below') {
        const threshold = condition.threshold ?? 30
        matchedEntityIds = latestScores
          .filter((s) => getSubScore(s, condition.sub_score) <= threshold)
          .map((s) => s.entity_id)
      } else if (condition.type === 'new_entity') {
        matchedEntityIds = newEntities.map((e) => e.id)
      } else if (condition.type === 'momentum_spike') {
        const threshold = condition.threshold ?? 20
        matchedEntityIds = Array.from(mentionByEntity.entries())
          .filter(([, v]) => v >= threshold)
          .map(([id]) => id)
      }

      if (matchedEntityIds.length === 0) continue

      // Find which entity IDs already have an alert_event for this rule in the last 24h
      const existingEvents = await db
        .select({ entityId: alertEvent.entityId })
        .from(alertEvent)
        .where(
          and(
            eq(alertEvent.ruleId, rule.id),
            gte(alertEvent.triggeredAt, twentyFourHoursAgo),
            inArray(alertEvent.entityId, matchedEntityIds)
          )
        )

      const alreadyFired = new Set(existingEvents.map((e) => e.entityId))
      const newFires = matchedEntityIds.filter((id) => !alreadyFired.has(id))

      if (newFires.length === 0) continue

      await db.insert(alertEvent).values(
        newFires.map((entityId) => ({
          ruleId: rule.id,
          entityId,
          triggeredAt: new Date(),
          delivered: false,
          payload: { condition, rule_name: rule.name } as Record<string, unknown>,
        }))
      )

      log.info({ ruleId: rule.id, ruleName: rule.name, newFires: newFires.length }, 'alert rule fired')
      totalFired += newFires.length
    }

    const durationMs = Date.now() - startMs
    log.info({ fired: totalFired, durationMs }, 'run-alerts complete')
    await writeSourceRun(startedAt, 'ok', totalFired, null)
    return NextResponse.json({ ok: true, fired: totalFired, durationMs })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error({ err }, 'run-alerts failed')
    await writeSourceRun(startedAt, 'error', totalFired, msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

async function writeSourceRun(
  startedAt: Date,
  status: 'ok' | 'error',
  itemsIngested: number,
  errorMessage: string | null
) {
  await db.insert(sourceRun).values({
    sourceId: 'run-alerts',
    startedAt,
    finishedAt: new Date(),
    status,
    itemsIngested,
    errorMessage,
  })
}
