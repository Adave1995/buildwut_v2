import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 10 // seconds (Vercel Hobby max)

import { db } from '@/lib/db'
import { sourceRun } from '@/lib/db/schema'
import { computeMetrics } from '@/lib/scoring/metrics'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = new Date()
  let metricsWritten = 0
  let errorMessage: string | null = null

  try {
    const result = await computeMetrics()
    metricsWritten = result.metricsWritten
  } catch (err) {
    errorMessage = String(err)
  }

  const status = errorMessage ? 'error' : 'ok'

  await db.insert(sourceRun).values({
    sourceId: 'compute-metrics',
    startedAt,
    finishedAt: new Date(),
    status,
    itemsIngested: metricsWritten,
    errorMessage,
  })

  const durationMs = Date.now() - startedAt.getTime()
  return NextResponse.json({ ok: !errorMessage, metricsWritten, durationMs })
}
