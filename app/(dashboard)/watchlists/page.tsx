import { db } from '@/lib/db'
import { watchlist, watchlistEntity } from '@/lib/db/schema'
import { eq, count } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { WatchlistsClient } from '@/components/watchlists-client'

async function getWatchlists(userId: string) {
  const rows = await db
    .select({
      id: watchlist.id,
      name: watchlist.name,
      entityCount: count(watchlistEntity.entityId),
    })
    .from(watchlist)
    .leftJoin(watchlistEntity, eq(watchlist.id, watchlistEntity.watchlistId))
    .where(eq(watchlist.userId, userId))
    .groupBy(watchlist.id, watchlist.name)
    .orderBy(watchlist.createdAt)

  return rows.map((r) => ({ ...r, entityCount: Number(r.entityCount) }))
}

export default async function WatchlistsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const lists = user ? await getWatchlists(user.id) : []
  return <WatchlistsClient initial={lists} />
}
