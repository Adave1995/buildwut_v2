import { db } from '@/lib/db'
import { alertEvent, alertRule } from '@/lib/db/schema'
import { createClient } from '@/lib/supabase/server'
import { eq, and, inArray } from 'drizzle-orm'

export async function AlertBadge() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const rules = await db
    .select({ id: alertRule.id })
    .from(alertRule)
    .where(eq(alertRule.userId, user.id))

  if (rules.length === 0) return null

  const ruleIds = rules.map((r) => r.id)

  const [row] = await db
    .select({ id: alertEvent.id })
    .from(alertEvent)
    .where(and(eq(alertEvent.delivered, false), inArray(alertEvent.ruleId, ruleIds)))
    .limit(1)

  if (!row) return null

  return (
    <span className="ml-auto size-2 rounded-full bg-primary shrink-0" aria-label="Unread alerts" />
  )
}
