'use server'

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { pipelineItem } from '@/lib/db/schema'
import { createClient } from '@/lib/supabase/server'

async function getUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthenticated')
  return user
}

export async function addToPipeline(entityId: string): Promise<void> {
  const user = await getUser()

  await db
    .insert(pipelineItem)
    .values({ userId: user.id, entityId, stage: 'inbox' })
    .onConflictDoNothing()

  revalidatePath('/feed')
  revalidatePath('/pipeline')
}

export async function updatePipelineStage(itemId: string, stage: string): Promise<void> {
  const user = await getUser()

  await db
    .update(pipelineItem)
    .set({ stage, updatedAt: new Date() })
    .where(and(eq(pipelineItem.id, itemId), eq(pipelineItem.userId, user.id)))

  revalidatePath('/pipeline')
}

export async function removeFromPipeline(itemId: string): Promise<void> {
  const user = await getUser()

  await db
    .delete(pipelineItem)
    .where(and(eq(pipelineItem.id, itemId), eq(pipelineItem.userId, user.id)))

  revalidatePath('/feed')
  revalidatePath('/pipeline')
}

export async function saveNotes(itemId: string, notes: string): Promise<void> {
  const user = await getUser()

  await db
    .update(pipelineItem)
    .set({ notes, updatedAt: new Date() })
    .where(and(eq(pipelineItem.id, itemId), eq(pipelineItem.userId, user.id)))
}
