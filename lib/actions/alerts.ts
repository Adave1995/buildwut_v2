'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { alertRule, alertEvent } from '@/lib/db/schema'
import { createClient } from '@/lib/supabase/server'
import { eq, and, inArray } from 'drizzle-orm'
import { z } from 'zod'
import type { AlertCondition } from '@/lib/db/schema'

const ConditionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('score_above'),
    threshold: z.number().min(0).max(100),
    sub_score: z.string().optional(),
  }),
  z.object({
    type: z.literal('score_below'),
    threshold: z.number().min(0).max(100),
    sub_score: z.string().optional(),
  }),
  z.object({
    type: z.literal('new_entity'),
  }),
  z.object({
    type: z.literal('momentum_spike'),
    threshold: z.number().min(1).optional(),
  }),
])

const CreateAlertSchema = z.object({
  name: z.string().min(1).max(100),
  condition: ConditionSchema,
  delivery: z.array(z.enum(['in_app', 'email'])).min(1),
})

async function getUserId(): Promise<string> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  return user.id
}

export async function createAlertRule(formData: FormData) {
  const userId = await getUserId()

  const raw = {
    name: formData.get('name'),
    condition: JSON.parse(formData.get('condition') as string),
    delivery: JSON.parse(formData.get('delivery') as string),
  }

  const parsed = CreateAlertSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  await db.insert(alertRule).values({
    userId,
    name: parsed.data.name,
    condition: parsed.data.condition as AlertCondition,
    delivery: parsed.data.delivery,
    enabled: true,
  })

  revalidatePath('/alerts')
  return { ok: true }
}

export async function toggleAlertRule(ruleId: string, enabled: boolean) {
  const userId = await getUserId()

  await db
    .update(alertRule)
    .set({ enabled })
    .where(and(eq(alertRule.id, ruleId), eq(alertRule.userId, userId)))

  revalidatePath('/alerts')
}

export async function deleteAlertRule(ruleId: string) {
  const userId = await getUserId()

  await db
    .delete(alertRule)
    .where(and(eq(alertRule.id, ruleId), eq(alertRule.userId, userId)))

  revalidatePath('/alerts')
}

export async function markAlertsRead() {
  const userId = await getUserId()

  // Get all rule IDs belonging to this user
  const rules = await db
    .select({ id: alertRule.id })
    .from(alertRule)
    .where(eq(alertRule.userId, userId))

  if (rules.length === 0) return

  const ruleIds = rules.map((r) => r.id)

  await db
    .update(alertEvent)
    .set({ delivered: true })
    .where(and(eq(alertEvent.delivered, false), inArray(alertEvent.ruleId, ruleIds)))

  revalidatePath('/alerts')
}
