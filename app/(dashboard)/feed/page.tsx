import Link from 'next/link'
import { db } from '@/lib/db'
import { scoreSnapshot, entity, pipelineItem, hiddenEntity, watchlist, watchlistEntity } from '@/lib/db/schema'
import { desc, eq, max, and, notInArray } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { FeedCard } from '@/components/feed-card'
import type { FeedCardRow } from '@/components/feed-card'
import { HelpTip } from '@/components/help-tip'

async function getExcludedIds(userId: string): Promise<string[]> {
  const [hidden, pipeline, watchlisted] = await Promise.all([
    db.select({ entityId: hiddenEntity.entityId }).from(hiddenEntity).where(eq(hiddenEntity.userId, userId)),
    db.select({ entityId: pipelineItem.entityId }).from(pipelineItem).where(eq(pipelineItem.userId, userId)),
    db
      .select({ entityId: watchlistEntity.entityId })
      .from(watchlistEntity)
      .innerJoin(watchlist, eq(watchlistEntity.watchlistId, watchlist.id))
      .where(eq(watchlist.userId, userId)),
  ])
  const ids = new Set<string>()
  for (const r of [...hidden, ...pipeline, ...watchlisted]) ids.add(r.entityId)
  return [...ids]
}

async function getFeed(excludedIds: string[]): Promise<FeedCardRow[]> {
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
    .where(excludedIds.length > 0 ? notInArray(entity.id, excludedIds) : undefined)
    .orderBy(desc(scoreSnapshot.totalScore))
    .limit(50)
}

export default async function FeedPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const excludedIds = user ? await getExcludedIds(user.id) : []
  const feed = await getFeed(excludedIds)

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
              isInPipeline={false}
            />
          ))}
        </div>
      )}
    </div>
  )
}
