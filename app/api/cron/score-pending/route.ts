import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 10 // seconds (Vercel Hobby max)

import { db } from '@/lib/db'
import { scoreSnapshot, sourceRun } from '@/lib/db/schema'
import { sql, gte, count } from 'drizzle-orm'
import { scoreEntity } from '@/lib/scoring/scorer'

const DAILY_SCORE_BUDGET = 50

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
 * Find one entity eligible for scoring using a single efficient JOIN query:
 * - Has mentions_24h >= 10 in the last 24h (from metric_timeseries)
 *   OR has never been scored at all
 * - Has NOT been scored in the last 7 days
 */
async function findEntityToScore(): Promise<string | null> {
  type Row = { entity_id: string }

  // Priority 1: entities with high recent mentions, not recently scored
  const [highMention] = await db.execute<Row>(sql`
    SELECT DISTINCT mt.entity_id
    FROM metric_timeseries mt
    LEFT JOIN score_snapshot ss
      ON mt.entity_id = ss.entity_id
      AND ss.as_of >= NOW() - INTERVAL '7 days'
    WHERE mt.metric_name = 'mentions_24h'
      AND mt.value::numeric >= 10
      AND mt.t >= NOW() - INTERVAL '24 hours'
      AND ss.entity_id IS NULL
    LIMIT 1
  `)

  if (highMention) return highMention.entity_id

  // Priority 2: any entity that has never been scored
  const [unscored] = await db.execute<Row>(sql`
    SELECT e.id AS entity_id
    FROM entity e
    LEFT JOIN score_snapshot ss ON e.id = ss.entity_id
    WHERE ss.entity_id IS NULL
    LIMIT 1
  `)

  return unscored?.entity_id ?? null
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = new Date()
  const startMs = Date.now()

  // Check daily budget before anything expensive
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

  // Pass startMs so scoreEntity can bail before hitting the 10s wall
  const result = await scoreEntity(entityId, startMs)

  const status = result.ok ? 'ok' : 'error'
  const durationMs = Date.now() - startMs

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
