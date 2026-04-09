import { notFound } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { watchlist, watchlistEntity, entity, scoreSnapshot } from '@/lib/db/schema'
import { and, desc, eq, max } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

async function getWatchlistDetail(watchlistId: string, userId: string) {
  const [wl] = await db
    .select()
    .from(watchlist)
    .where(and(eq(watchlist.id, watchlistId), eq(watchlist.userId, userId)))
    .limit(1)

  if (!wl) return null

  // Get entities in watchlist with their latest score
  const latestPerEntity = db
    .select({
      entityId: scoreSnapshot.entityId,
      maxAsOf: max(scoreSnapshot.asOf).as('max_as_of'),
    })
    .from(scoreSnapshot)
    .groupBy(scoreSnapshot.entityId)
    .as('latest_score')

  const entities = await db
    .select({
      entityId: entity.id,
      entityName: entity.name,
      entityCategory: entity.category,
      entityUrl: entity.url,
      totalScore: scoreSnapshot.totalScore,
      oneSentencePitch: scoreSnapshot.oneSentencePitch,
      asOf: scoreSnapshot.asOf,
    })
    .from(watchlistEntity)
    .innerJoin(entity, eq(watchlistEntity.entityId, entity.id))
    .leftJoin(latestPerEntity, eq(entity.id, latestPerEntity.entityId))
    .leftJoin(
      scoreSnapshot,
      and(
        eq(scoreSnapshot.entityId, entity.id),
        eq(scoreSnapshot.asOf, latestPerEntity.maxAsOf)
      )
    )
    .where(eq(watchlistEntity.watchlistId, watchlistId))
    .orderBy(desc(scoreSnapshot.totalScore))

  return { watchlist: wl, entities }
}

export default async function WatchlistDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) notFound()

  const data = await getWatchlistDetail(id, user.id)
  if (!data) notFound()

  const { watchlist: wl, entities } = data

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/watchlists"
          className="text-sm text-muted-foreground hover:text-foreground mb-3 inline-block"
        >
          ← Watchlists
        </Link>
        <h1 className="text-2xl font-semibold">{wl.name}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {entities.length} {entities.length === 1 ? 'opportunity' : 'opportunities'}
        </p>
      </div>

      {entities.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="font-medium">No opportunities saved yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Open any opportunity and use &ldquo;Save to watchlist&rdquo; to add it here.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {entities.map((e) => (
            <Link key={e.entityId} href={`/opportunities/${e.entityId}`}>
              <Card className="hover:border-foreground/30 transition-colors">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="font-semibold text-base leading-tight truncate">
                          {e.entityName}
                        </h2>
                        {e.entityCategory && (
                          <Badge variant="secondary" className="text-xs shrink-0">
                            {e.entityCategory}
                          </Badge>
                        )}
                      </div>
                      {e.oneSentencePitch && (
                        <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                          {e.oneSentencePitch}
                        </p>
                      )}
                    </div>
                    {e.totalScore != null && (
                      <div className="text-2xl font-bold tabular-nums leading-none shrink-0">
                        {e.totalScore}
                        <span className="text-xs font-normal text-muted-foreground">/100</span>
                      </div>
                    )}
                  </div>
                </CardHeader>
                {e.entityUrl && (
                  <CardContent className="pt-0">
                    <span className="text-xs text-muted-foreground truncate block">
                      {e.entityUrl.replace(/^https?:\/\//, '')}
                    </span>
                  </CardContent>
                )}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
