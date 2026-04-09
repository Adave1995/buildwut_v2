import Link from 'next/link'
import { db } from '@/lib/db'
import { scoreSnapshot, entity } from '@/lib/db/schema'
import { desc, eq, max, and } from 'drizzle-orm'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import type { AdjacentNiche } from '@/lib/db/schema'

// Latest score snapshot per entity
async function getFeed() {
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
      // score
      scoreId: scoreSnapshot.id,
      totalScore: scoreSnapshot.totalScore,
      momentumScore: scoreSnapshot.momentumScore,
      distributionGapScore: scoreSnapshot.distributionGapScore,
      executionFeasibilityScore: scoreSnapshot.executionFeasibilityScore,
      oneSentencePitch: scoreSnapshot.oneSentencePitch,
      adjacentNiches: scoreSnapshot.adjacentNiches,
      asOf: scoreSnapshot.asOf,
      // entity
      entityId: entity.id,
      entityName: entity.name,
      entitySlug: entity.slug,
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
    .orderBy(desc(scoreSnapshot.totalScore))
    .limit(50)
}

function ScoreCircle({ score }: { score: number }) {
  const color =
    score >= 75 ? 'text-green-600' : score >= 50 ? 'text-yellow-600' : 'text-muted-foreground'
  return (
    <div className={`text-3xl font-bold tabular-nums leading-none ${color}`}>
      {score}
      <span className="text-sm font-normal text-muted-foreground">/100</span>
    </div>
  )
}

function SubScorePill({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </span>
  )
}

type FeedRow = Awaited<ReturnType<typeof getFeed>>[number]

function FeedCard({ row }: { row: FeedRow }) {
  const topNiche = (row.adjacentNiches as AdjacentNiche[] | null)?.[0]

  return (
    <Link href={`/opportunities/${row.entityId}`} className="block focus:outline-none">
      <Card className="hover:border-foreground/30 transition-colors">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-semibold text-base leading-tight truncate">
                  {row.entityName}
                </h2>
                {row.entityCategory && (
                  <Badge variant="secondary" className="text-xs shrink-0">
                    {row.entityCategory}
                  </Badge>
                )}
              </div>
              {row.oneSentencePitch && (
                <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                  {row.oneSentencePitch}
                </p>
              )}
            </div>
            <ScoreCircle score={row.totalScore} />
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex items-center gap-4 mb-3">
            <SubScorePill label="momentum" value={row.momentumScore} />
            <SubScorePill label="dist. gap" value={row.distributionGapScore} />
            <SubScorePill label="feasibility" value={row.executionFeasibilityScore} />
          </div>

          {topNiche && (
            <div className="rounded-md bg-muted/60 px-3 py-2 text-xs">
              <span className="font-medium text-foreground">Adjacent niche: </span>
              <span className="text-muted-foreground">
                {topNiche.niche} — {topNiche.suggested_angle}
              </span>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            {row.entityUrl && (
              <span
                className="truncate max-w-[200px]"
                title={row.entityUrl}
              >
                {row.entityUrl.replace(/^https?:\/\//, '')}
              </span>
            )}
            <span className="ml-auto shrink-0">
              {new Date(row.asOf).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

export default async function FeedPage() {
  const feed = await getFeed()

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Opportunity Feed</h1>
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
            <FeedCard key={row.scoreId} row={row} />
          ))}
        </div>
      )}
    </div>
  )
}
