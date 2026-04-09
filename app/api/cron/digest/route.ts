import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sourceRun } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'
import { sendDailyDigest } from '@/lib/email/digest'
import { logger } from '@/lib/logger'
import type { DigestOpportunity } from '@/lib/email/digest'

export const maxDuration = 30

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const to = process.env.DIGEST_EMAIL ?? process.env.ALLOWED_SIGNUP_EMAILS?.split(',')[0]
  if (!to) {
    return NextResponse.json({ ok: false, error: 'No DIGEST_EMAIL configured' }, { status: 500 })
  }

  const startedAt = new Date()
  const startMs = Date.now()
  const log = logger.child({ cron: 'digest' })

  try {
    // Get top 10 opportunities scored in the last 7 days, ranked by distribution_gap desc
    type Row = {
      entity_id: string
      name: string
      url: string | null
      category: string | null
      total_score: number
      distribution_gap_score: number
      one_sentence_pitch: string | null
      adjacent_niches: Array<{ niche: string }> | null
      as_of: Date
    }

    const rows = await db.execute<Row>(sql`
      SELECT DISTINCT ON (ss.entity_id)
        ss.entity_id,
        e.name,
        e.url,
        e.category,
        ss.total_score,
        ss.distribution_gap_score,
        ss.one_sentence_pitch,
        ss.adjacent_niches,
        ss.as_of
      FROM score_snapshot ss
      JOIN entity e ON ss.entity_id = e.id
      WHERE ss.as_of >= NOW() - INTERVAL '7 days'
      ORDER BY ss.entity_id, ss.as_of DESC
    `)

    // Sort by distribution gap desc, take top 10
    const top10 = [...rows]
      .sort((a, b) => b.distribution_gap_score - a.distribution_gap_score)
      .slice(0, 10)

    if (top10.length === 0) {
      log.info('no scored opportunities for digest, skipping')
      await writeSourceRun(startedAt, 'ok', 0, 'No scored opportunities')
      return NextResponse.json({ ok: true, sent: false, reason: 'no_opportunities' })
    }

    const opportunities: DigestOpportunity[] = top10.map((row) => ({
      id: row.entity_id,
      name: row.name,
      url: row.url,
      category: row.category,
      totalScore: row.total_score,
      distributionGapScore: row.distribution_gap_score,
      oneSentencePitch: row.one_sentence_pitch,
      topNiche: row.adjacent_niches?.[0]?.niche ?? null,
    }))

    const result = await sendDailyDigest(to, opportunities)

    const durationMs = Date.now() - startMs

    if (!result.ok) {
      log.error({ error: result.error }, 'digest email failed')
      await writeSourceRun(startedAt, 'error', 0, result.error ?? 'Send failed')
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 })
    }

    log.info({ to, count: opportunities.length, durationMs }, 'digest sent')
    await writeSourceRun(startedAt, 'ok', opportunities.length, null)
    return NextResponse.json({ ok: true, sent: true, count: opportunities.length, durationMs })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error({ err }, 'digest cron failed')
    await writeSourceRun(startedAt, 'error', 0, msg)
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
    sourceId: 'digest',
    startedAt,
    finishedAt: new Date(),
    status,
    itemsIngested,
    errorMessage,
  })
}
