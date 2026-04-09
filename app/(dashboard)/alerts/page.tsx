import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { alertRule, alertEvent, entity } from '@/lib/db/schema'
import { eq, desc, inArray } from 'drizzle-orm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AlertsClient } from '@/components/alerts-client'
import { markAlertsRead } from '@/lib/actions/alerts'

export default async function AlertsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  // Load this user's rules
  const rules = await db
    .select()
    .from(alertRule)
    .where(eq(alertRule.userId, user.id))
    .orderBy(desc(alertRule.createdAt))

  // Load recent alert events for this user's rules
  const ruleIds = rules.map((r) => r.id)
  const recentEvents =
    ruleIds.length > 0
      ? await db
          .select({
            id: alertEvent.id,
            ruleId: alertEvent.ruleId,
            entityId: alertEvent.entityId,
            triggeredAt: alertEvent.triggeredAt,
            delivered: alertEvent.delivered,
            entityName: entity.name,
          })
          .from(alertEvent)
          .innerJoin(entity, eq(alertEvent.entityId, entity.id))
          .where(inArray(alertEvent.ruleId, ruleIds))
          .orderBy(desc(alertEvent.triggeredAt))
          .limit(50)
      : []

  const unreadCount = recentEvents.filter((e) => !e.delivered).length

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Alerts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Get notified when opportunities match your criteria
          </p>
        </div>
        {unreadCount > 0 && (
          <form action={markAlertsRead}>
            <Button size="sm" variant="outline" type="submit">
              Mark all read
            </Button>
          </form>
        )}
      </div>

      {/* Recent events */}
      {recentEvents.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              Recent alerts
              {unreadCount > 0 && (
                <Badge className="rounded-full px-1.5 text-xs">{unreadCount} new</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentEvents.map((ev) => {
              const rule = rules.find((r) => r.id === ev.ruleId)
              return (
                <div
                  key={ev.id}
                  className={`flex items-start justify-between gap-3 py-2 border-b last:border-0 ${
                    !ev.delivered ? 'opacity-100' : 'opacity-60'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {!ev.delivered && (
                        <span className="size-1.5 rounded-full bg-primary shrink-0 mt-0.5" />
                      )}
                      <span className="text-sm font-medium truncate">{ev.entityName}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Rule: {rule?.name ?? ev.ruleId}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0 mt-0.5">
                    {new Date(ev.triggeredAt).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* Rules management */}
      <AlertsClient rules={rules} />
    </div>
  )
}
