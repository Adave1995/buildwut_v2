'use server'

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { watchlist, watchlistEntity } from '@/lib/db/schema'
import { createClient } from '@/lib/supabase/server'

async function getUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthenticated')
  return user
}

export async function createWatchlist(name: string): Promise<{ id: string }> {
  const user = await getUser()
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Name required')

  const [created] = await db
    .insert(watchlist)
    .values({ userId: user.id, name: trimmed })
    .returning({ id: watchlist.id })

  revalidatePath('/watchlists')
  return created
}

export async function deleteWatchlist(id: string): Promise<void> {
  const user = await getUser()

  await db
    .delete(watchlist)
    .where(and(eq(watchlist.id, id), eq(watchlist.userId, user.id)))

  revalidatePath('/watchlists')
}

export async function addToWatchlist(watchlistId: string, entityId: string): Promise<void> {
  const user = await getUser()

  // Verify the watchlist belongs to the user
  const [wl] = await db
    .select({ id: watchlist.id })
    .from(watchlist)
    .where(and(eq(watchlist.id, watchlistId), eq(watchlist.userId, user.id)))
    .limit(1)

  if (!wl) throw new Error('Watchlist not found')

  await db
    .insert(watchlistEntity)
    .values({ watchlistId, entityId })
    .onConflictDoNothing()

  revalidatePath(`/watchlists/${watchlistId}`)
}

export async function removeFromWatchlist(watchlistId: string, entityId: string): Promise<void> {
  const user = await getUser()

  // Verify ownership
  const [wl] = await db
    .select({ id: watchlist.id })
    .from(watchlist)
    .where(and(eq(watchlist.id, watchlistId), eq(watchlist.userId, user.id)))
    .limit(1)

  if (!wl) throw new Error('Watchlist not found')

  await db
    .delete(watchlistEntity)
    .where(
      and(
        eq(watchlistEntity.watchlistId, watchlistId),
        eq(watchlistEntity.entityId, entityId)
      )
    )

  revalidatePath(`/watchlists/${watchlistId}`)
}
