import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 10 // seconds (Vercel Hobby max)

import { db } from '@/lib/db'
import { entity, metricTimeseries, scoreSnapshot, sourceRun } from '@/lib/db/schema'
import { sql, gte, eq, and, count } from 'drizzle-orm'
import { scoreEntity } from '@/lib/scoring/scorer'

const DAILY_SCORE_BUDGET = 50
const SCORE_CACHE_DAYS = 7

async function getDailyScoreCount(): Promise<number> {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const [row] = await db
    .select({ n: count() })
    .from(scoreSnapshot)
    .where(gte(scoreSnapshot.asOf, todayStart))

  return Number(row?.n ?? 0)
}

/**
 * Find one entity eligible for scoring:
 * - Has mentions_24h >= 10 in the last 24h (OR has no score at all)
 * - Has NOT been scored in the last SCORE_CACHE_DAYS days
 */
async function findEntityToScore(): Promise<string | null> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const scoreCutoff = new Date(Date.now() - SCORE_CACHE_DAYS * 24 * 60 * 60 * 1000)

  // Entities scored recently — exclude these
  const recentlyScored = db
    .select({ entityId: scoreSnapshot.entityId })
    .from(scoreSnapshot)
    .where(gte(scoreSnapshot.asOf, scoreCutoff))

  // Entities with high mentions in the last 24h
  const highMentions = db
    .select({ entityId: metricTimeseries.entityId })
    .from(metricTimeseries)
    .where(
      and(
        eq(metricTimeseries.metricName, 'mentions_24h'),
        gte(metricTimeseries.t, since24h),
        sql`${metricTimeseries.value}::numeric >= 10`
      )
    )

  // Entities that have never been scored at all
  const neverScored = db
    .select({ entityId: scoreSnapshot.entityId })
    .from(scoreSnapshot)

  // Pick first eligible: high-mention entities not recently scored
  // Fall back to any entity never scored
  const [candidate] = await db
    .select({ id: entity.id })
    .from(entity)
    .where(
      and(
        sql`${entity.id} NOT IN (${recentlyScored})`,
        sql`(
          ${entity.id} IN (${highMentions})
          OR ${entity.id} NOT IN (${neverScored})
        )`
      )
    )
    .limit(1)

  return candidate?.id ?? null
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = new Date()

  // Check daily budget before doing anything expensive
  const dailyCount = await getDailyScoreCount()
  if (dailyCount >= DAILY_SCORE_BUDGET) {
    await db.insert(sourceRun).values({
      sourceId: 'score-pending',
      startedAt,
      finishedAt: new Date(),
      status: 'ok',
      itemsIngested: 0,
      errorMessage: `Daily budget reached (${dailyCount}/${DAILY_SCORE_BUDGET})`,
    })
    return NextResponse.json({ ok: true, scored: 0, reason: 'daily_budget_reached' })
  }

  const entityId = await findEntityToScore()

  if (!entityId) {
    await db.insert(sourceRun).values({
      sourceId: 'score-pending',
      startedAt,
      finishedAt: new Date(),
      status: 'ok',
      itemsIngested: 0,
      errorMessage: null,
    })
    return NextResponse.json({ ok: true, scored: 0, reason: 'no_eligible_entities' })
  }

  const result = await scoreEntity(entityId)

  const status = result.ok ? 'ok' : 'error'
  const durationMs = Date.now() - startedAt.getTime()

  await db.insert(sourceRun).values({
    sourceId: 'score-pending',
    startedAt,
    finishedAt: new Date(),
    status,
    itemsIngested: result.ok ? 1 : 0,
    errorMessage: result.ok ? null : result.reason,
  })

  return NextResponse.json({
    ok: result.ok,
    scored: result.ok ? 1 : 0,
    entityId,
    ...(result.ok ? { scoreId: result.scoreId } : { error: result.reason }),
    durationMs,
  })
}
