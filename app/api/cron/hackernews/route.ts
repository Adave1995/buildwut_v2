import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30 // seconds
import { db } from '@/lib/db'
import { sourceRun } from '@/lib/db/schema'
import { getSource } from '@/lib/sources/registry'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const source = getSource('hackernews')
  if (!source) {
    return NextResponse.json({ error: 'Source not found' }, { status: 404 })
  }

  if (!source.enabled) {
    return NextResponse.json({ ok: true, message: 'Source disabled', itemsIngested: 0 })
  }

  const startedAt = new Date()
  let result = { ok: false, itemsIngested: 0, errors: ['Unknown error'] }

  try {
    result = await source.ingest()
  } catch (err) {
    result = { ok: false, itemsIngested: 0, errors: [String(err)] }
  }

  const status =
    result.ok ? 'ok'
    : result.itemsIngested > 0 ? 'partial'
    : 'error'

  // Always write source_run — this is what the /sources health page reads
  await db.insert(sourceRun).values({
    sourceId: source.id,
    startedAt,
    finishedAt: new Date(),
    status,
    itemsIngested: result.itemsIngested,
    errorMessage: result.errors.length > 0 ? result.errors.slice(0, 3).join('; ') : null,
  })

  const durationMs = Date.now() - startedAt.getTime()
  return NextResponse.json({ ok: result.ok, itemsIngested: result.itemsIngested, durationMs })
}
