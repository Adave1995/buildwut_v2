'use client'

import { useState, useTransition } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { createAlertRule, toggleAlertRule, deleteAlertRule } from '@/lib/actions/alerts'
import type { alertRule } from '@/lib/db/schema'
import type { InferSelectModel } from 'drizzle-orm'

type AlertRule = InferSelectModel<typeof alertRule>

const CONDITION_LABELS: Record<string, string> = {
  score_above: 'Score above',
  score_below: 'Score below',
  new_entity: 'New entity discovered',
  momentum_spike: 'Momentum spike',
}

const SUB_SCORE_OPTIONS = [
  { value: '', label: 'Total score' },
  { value: 'momentum', label: 'Momentum' },
  { value: 'engagement_quality', label: 'Engagement quality' },
  { value: 'distribution_gap', label: 'Distribution gap' },
  { value: 'market_tailwinds', label: 'Market tailwinds' },
  { value: 'fundamentals', label: 'Fundamentals' },
  { value: 'execution_feasibility', label: 'Execution feasibility' },
]

function conditionSummary(rule: AlertRule): string {
  const c = rule.condition
  if (c.type === 'score_above') {
    const label = c.sub_score
      ? SUB_SCORE_OPTIONS.find((o) => o.value === c.sub_score)?.label ?? c.sub_score
      : 'Total score'
    return `${label} ≥ ${c.threshold ?? 70}`
  }
  if (c.type === 'score_below') {
    const label = c.sub_score
      ? SUB_SCORE_OPTIONS.find((o) => o.value === c.sub_score)?.label ?? c.sub_score
      : 'Total score'
    return `${label} ≤ ${c.threshold ?? 30}`
  }
  if (c.type === 'new_entity') return 'Any new entity'
  if (c.type === 'momentum_spike') return `Mentions ≥ ${c.threshold ?? 20} in 24h`
  return ''
}

export function AlertsClient({ rules }: { rules: AlertRule[] }) {
  const [showForm, setShowForm] = useState(false)
  const [conditionType, setConditionType] = useState<string>('score_above')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const needsThreshold = conditionType === 'score_above' || conditionType === 'score_below'
  const needsSubScore = needsThreshold
  const isMomentum = conditionType === 'momentum_spike'

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)

    const fd = new FormData(e.currentTarget)
    const name = fd.get('name') as string
    const threshold = fd.get('threshold') ? Number(fd.get('threshold')) : undefined
    const sub_score = fd.get('sub_score') as string || undefined
    const delivery = fd.getAll('delivery') as string[]

    let condition: Record<string, unknown>
    if (conditionType === 'score_above' || conditionType === 'score_below') {
      condition = { type: conditionType, threshold, sub_score: sub_score || undefined }
    } else if (conditionType === 'momentum_spike') {
      condition = { type: conditionType, threshold }
    } else {
      condition = { type: conditionType }
    }

    const formData = new FormData()
    formData.set('name', name)
    formData.set('condition', JSON.stringify(condition))
    formData.set('delivery', JSON.stringify(delivery.length > 0 ? delivery : ['in_app']))

    const result = await createAlertRule(formData)
    setPending(false)

    if (result && 'error' in result) {
      setError(result.error ?? 'Unknown error')
    } else {
      setShowForm(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Alert rules</CardTitle>
          <Button size="sm" variant="secondary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : '+ New rule'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showForm && (
          <form onSubmit={handleCreate} className="space-y-3 rounded-lg border p-4 bg-muted/30">
            <div className="space-y-1">
              <label className="text-xs font-medium">Rule name</label>
              <input
                name="name"
                required
                placeholder="e.g. High distribution gap"
                className="w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Condition</label>
              <select
                name="condition_type"
                value={conditionType}
                onChange={(e) => setConditionType(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
              >
                {Object.entries(CONDITION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            {needsSubScore && (
              <div className="space-y-1">
                <label className="text-xs font-medium">Score dimension</label>
                <select
                  name="sub_score"
                  className="w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                >
                  {SUB_SCORE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {(needsThreshold || isMomentum) && (
              <div className="space-y-1">
                <label className="text-xs font-medium">
                  {isMomentum ? 'Mention threshold' : 'Score threshold (0–100)'}
                </label>
                <input
                  name="threshold"
                  type="number"
                  min={isMomentum ? 1 : 0}
                  max={isMomentum ? undefined : 100}
                  defaultValue={isMomentum ? 20 : 70}
                  required
                  className="w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            )}
            <div className="space-y-1">
              <label className="text-xs font-medium">Delivery</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="checkbox" name="delivery" value="in_app" defaultChecked />
                  In-app
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="checkbox" name="delivery" value="email" />
                  Email
                </label>
              </div>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button size="sm" type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Create rule'}
            </Button>
          </form>
        )}

        {rules.length === 0 && !showForm && (
          <p className="text-sm text-muted-foreground">No alert rules yet.</p>
        )}

        {rules.map((rule) => (
          <div key={rule.id} className="flex items-start justify-between gap-3 py-2 border-b last:border-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{rule.name}</span>
                <Badge variant={rule.enabled ? 'default' : 'secondary'} className="text-xs">
                  {rule.enabled ? 'on' : 'off'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {CONDITION_LABELS[rule.condition.type] ?? rule.condition.type} ·{' '}
                {conditionSummary(rule)}
              </p>
              <p className="text-xs text-muted-foreground">
                Delivery: {rule.delivery.join(', ')}
              </p>
            </div>
            <div className="flex gap-1 shrink-0">
              <Button
                size="sm"
                variant="ghost"
                className="text-xs h-7 px-2"
                onClick={() => startTransition(() => toggleAlertRule(rule.id, !rule.enabled))}
              >
                {rule.enabled ? 'Pause' : 'Enable'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs h-7 px-2 text-destructive hover:text-destructive"
                onClick={() => startTransition(() => deleteAlertRule(rule.id))}
              >
                Delete
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
