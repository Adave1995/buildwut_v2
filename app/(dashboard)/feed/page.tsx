import Link from 'next/link'
import { db } from '@/lib/db'
import { scoreSnapshot, entity, pipelineItem, hiddenEntity } from '@/lib/db/schema'
import { desc, eq, max, and, notInArray } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { FeedCard } from '@/components/feed-card'
import type { FeedCardRow } from '@/components/feed-card'
import { HelpTip } from '@/components/help-tip'

async function getFeed(userId: string | undefined): Promise<FeedCardRow[]> {
  let hiddenIds: string[] = []
  if (userId) {
    const hidden = await db
      .select({ entityId: hiddenEntity.entityId })
      .from(hiddenEntity)
      .where(eq(hiddenEntity.userId, userId))
    hiddenIds = hidden.map((h) => h.entityId)
  }

  // Subquery: latest as_of per entity
  const latestPerEntity = db
    .select({
      entityId: scoreSnapshot.entityId,
      maxAsOf: max(scoreSnapshot.asOf).as('max_as_of'),
    })
    .from(scoreSnapshot)
    .groupBy(scoreSnapshot.entityId)
    .as('latest')

  return db
    .select({
      scoreId: scoreSnapshot.id,
      totalScore: scoreSnapshot.totalScore,
      momentumScore: scoreSnapshot.momentumScore,
      distributionGapScore: scoreSnapshot.distributionGapScore,
      executionFeasibilityScore: scoreSnapshot.executionFeasibilityScore,
      oneSentencePitch: scoreSnapshot.oneSentencePitch,
      adjacentNiches: scoreSnapshot.adjacentNiches,
      asOf: scoreSnapshot.asOf,
      entityId: entity.id,
      entityName: entity.name,
      entityUrl: entity.url,
      entityCategory: entity.category,
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
    .where(hiddenIds.length > 0 ? notInArray(entity.id, hiddenIds) : undefined)
    .orderBy(desc(scoreSnapshot.totalScore))
    .limit(50)
}

async function getPipelineEntityIds(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ entityId: pipelineItem.entityId })
    .from(pipelineItem)
    .where(eq(pipelineItem.userId, userId))
  return new Set(rows.map((r) => r.entityId))
}

export default async function FeedPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [feed, pipelineIds] = await Promise.all([
    getFeed(user?.id),
    user ? getPipelineEntityIds(user.id) : Promise.resolve(new Set<string>()),
  ])

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">Opportunity Feed</h1>
          <HelpTip
            title="Opportunity Feed"
            content="Every product and project BuildWut has discovered and AI-scored, ranked best to worst by total score. New items appear here automatically as sources ingest every 30 min–24h depending on the source. Click any card to open the full AI analysis. Hover a card to reveal '+Pipeline' (start tracking it) and 'Hide' (remove it from your feed permanently)."
          />
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Ranked by total score · updated as sources ingest
        </p>
      </div>

      {feed.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="font-medium">No scored opportunities yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            HN ingest runs every 30 min. Scoring triggers once entities accumulate ≥10 mentions.
            Check the{' '}
            <Link href="/sources" className="underline underline-offset-2">
              sources page
            </Link>{' '}
            to confirm ingest is healthy.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {feed.map((row) => (
            <FeedCard
              key={row.scoreId}
              row={row}
              isInPipeline={pipelineIds.has(row.entityId)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
