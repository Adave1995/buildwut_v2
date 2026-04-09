'use server'

import { revalidatePath } from 'next/cache'
import { eq, and } from 'drizzle-orm'
import { db } from '@/lib/db'
import { hiddenEntity } from '@/lib/db/schema'
import { createClient } from '@/lib/supabase/server'

async function getUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthenticated')
  return user
}

export async function hideEntity(entityId: string): Promise<void> {
  const user = await getUser()

  await db
    .insert(hiddenEntity)
    .values({ userId: user.id, entityId })
    .onConflictDoNothing()

  revalidatePath('/feed')
}

export async function unhideEntity(entityId: string): Promise<void> {
  const user = await getUser()

  await db
    .delete(hiddenEntity)
    .where(and(eq(hiddenEntity.userId, user.id), eq(hiddenEntity.entityId, entityId)))

  revalidatePath('/feed')
}
