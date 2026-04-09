import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scoreSnapshot, entity } from '@/lib/db/schema'
import { desc, eq, max, and } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import type { AdjacentNiche } from '@/lib/db/schema'

function escapeCsv(value: string | null | undefined): string {
  if (value == null) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const latestPerEntity = db
    .select({
      entityId: scoreSnapshot.entityId,
      maxAsOf: max(scoreSnapshot.asOf).as('max_as_of'),
    })
    .from(scoreSnapshot)
    .groupBy(scoreSnapshot.entityId)
    .as('latest')

  const rows = await db
    .select({
      entityName: entity.name,
      entityCategory: entity.category,
      entityUrl: entity.url,
      totalScore: scoreSnapshot.totalScore,
      momentumScore: scoreSnapshot.momentumScore,
      engagementQualityScore: scoreSnapshot.engagementQualityScore,
      distributionGapScore: scoreSnapshot.distributionGapScore,
      marketTailwindsScore: scoreSnapshot.marketTailwindsScore,
      fundamentalsScore: scoreSnapshot.fundamentalsScore,
      executionFeasibilityScore: scoreSnapshot.executionFeasibilityScore,
      reasoning: scoreSnapshot.reasoning,
      adjacentNiches: scoreSnapshot.adjacentNiches,
      oneSentencePitch: scoreSnapshot.oneSentencePitch,
      asOf: scoreSnapshot.asOf,
      model: scoreSnapshot.model,
    })
    .from(scoreSnapshot)
    .innerJoin(
      latestPerEntity,
      and(
        eq(scoreSnapshot.entityId, latestPerEntity.entityId),
        eq(scoreSnapshot.asOf, latestPerEntity.maxAsOf)
      )
    )
    .innerJoin(entity, eq(scoreSnapshot.entityId, entity.id))
    .orderBy(desc(scoreSnapshot.totalScore))

  const headers = [
    'name',
    'category',
    'url',
    'total_score',
    'momentum',
    'engagement_quality',
    'distribution_gap',
    'market_tailwinds',
    'fundamentals',
    'execution_feasibility',
    'top_adjacent_niche',
    'one_sentence_pitch',
    'reasoning',
    'scored_at',
    'model',
  ]

  const csvRows = rows.map((r) => {
    const niches = (r.adjacentNiches ?? []) as AdjacentNiche[]
    const topNiche = niches[0] ? `${niches[0].niche}: ${niches[0].suggested_angle}` : ''
    return [
      escapeCsv(r.entityName),
      escapeCsv(r.entityCategory),
      escapeCsv(r.entityUrl),
      String(r.totalScore),
      String(r.momentumScore),
      String(r.engagementQualityScore),
      String(r.distributionGapScore),
      String(r.marketTailwindsScore),
      String(r.fundamentalsScore),
      String(r.executionFeasibilityScore),
      escapeCsv(topNiche),
      escapeCsv(r.oneSentencePitch),
      escapeCsv(r.reasoning),
      new Date(r.asOf).toISOString(),
      escapeCsv(r.model),
    ].join(',')
  })

  const csv = [headers.join(','), ...csvRows].join('\n')

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="opportunities.csv"',
    },
  })
}
