import { notFound } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { entity, scoreSnapshot, pipelineItem, watchlist, metricTimeseries } from '@/lib/db/schema'
import { eq, desc, and, gte } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NotesEditor } from '@/components/notes-editor'
import { AddToWatchlistDialog } from '@/components/add-to-watchlist-dialog'
import { SignalsChart } from '@/components/signals-chart'
import { addToPipeline } from '@/lib/actions/pipeline'
import type { AdjacentNiche, Evidence } from '@/lib/db/schema'

async function getOpportunity(entityId: string, userId: string | undefined) {
  const [entityRow] = await db
    .select()
    .from(entity)
    .where(eq(entity.id, entityId))
    .limit(1)

  if (!entityRow) return null

  const [score] = await db
    .select()
    .from(scoreSnapshot)
    .where(eq(scoreSnapshot.entityId, entityId))
    .orderBy(desc(scoreSnapshot.asOf))
    .limit(1)

  let pipelineRow: { id: string; notes: string | null } | null = null
  let userWatchlists: { id: string; name: string }[] = []

  if (userId) {
    const [pi] = await db
      .select({ id: pipelineItem.id, notes: pipelineItem.notes })
      .from(pipelineItem)
      .where(and(eq(pipelineItem.entityId, entityId), eq(pipelineItem.userId, userId)))
      .limit(1)

    pipelineRow = pi ?? null

    userWatchlists = await db
      .select({ id: watchlist.id, name: watchlist.name })
      .from(watchlist)
      .where(eq(watchlist.userId, userId))
      .orderBy(watchlist.createdAt)
  }

  return { entity: entityRow, score: score ?? null, pipelineRow, userWatchlists }
}

async function getSignals(entityId: string) {
  const since = new Date()
  since.setDate(since.getDate() - 30)

  const rows = await db
    .select()
    .from(metricTimeseries)
    .where(and(eq(metricTimeseries.entityId, entityId), gte(metricTimeseries.t, since)))
    .orderBy(metricTimeseries.t)

  // Pivot: collect unique metric names, then group by timestamp bucket (day)
  const metricSet = new Set<string>()
  const byDay = new Map<string, Record<string, number>>()

  for (const row of rows) {
    metricSet.add(row.metricName)
    const day = row.t.toISOString().slice(0, 10)
    const existing = byDay.get(day) ?? {}
    // Take latest value per metric per day
    existing[row.metricName] = Number(row.value)
    byDay.set(day, existing)
  }

  const metrics = Array.from(metricSet)
  const data = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([t, vals]) => ({ t, ...vals }))

  return { data, metrics }
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const width = `${value}%`
  const color =
    value >= 75 ? 'bg-green-500' : value >= 50 ? 'bg-yellow-500' : 'bg-muted-foreground/50'
  return (
    <div className="flex items-center gap-3">
      <span className="w-40 shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width }} />
      </div>
      <span className="w-8 text-right text-sm tabular-nums">{value}</span>
    </div>
  )
}

type DifficultyBadgeProps = { difficulty: AdjacentNiche['estimated_difficulty'] }
function DifficultyBadge({ difficulty }: DifficultyBadgeProps) {
  const variant =
    difficulty === 'low' ? 'default' : difficulty === 'medium' ? 'secondary' : ('outline' as const)
  return <Badge variant={variant}>{difficulty}</Badge>
}

type SignalBadgeProps = { type: Evidence['signal_type'] }
function SignalBadge({ type }: SignalBadgeProps) {
  return (
    <Badge variant="outline" className="text-xs">
      {type.replace('_', ' ')}
    </Badge>
  )
}

export default async function OpportunityPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [data, signals] = await Promise.all([
    getOpportunity(id, user?.id),
    getSignals(id),
  ])
  if (!data) notFound()

  const { entity: e, score, pipelineRow, userWatchlists } = data
  const niches = (score?.adjacentNiches ?? []) as AdjacentNiche[]
  const evidence = (score?.evidence ?? []) as Evidence[]
  const redFlags = score?.redFlags ?? []
  const isInPipeline = pipelineRow !== null

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/feed"
          className="text-sm text-muted-foreground hover:text-foreground mb-3 inline-block"
        >
          ← Feed
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{e.name}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {e.category && <Badge variant="secondary">{e.category}</Badge>}
              {e.url && (
                <a
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2 truncate max-w-[300px]"
                >
                  {e.url.replace(/^https?:\/\//, '')}
                </a>
              )}
            </div>
          </div>
          {score && (
            <div className="text-right shrink-0">
              <div className="text-4xl font-bold tabular-nums leading-none">{score.totalScore}</div>
              <div className="text-xs text-muted-foreground mt-0.5">total score</div>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 mt-4">
          {!isInPipeline ? (
            <form
              action={async () => {
                'use server'
                await addToPipeline(e.id)
              }}
            >
              <Button size="sm" variant="secondary" type="submit">
                + Add to Pipeline
              </Button>
            </form>
          ) : (
            <Badge variant="outline" className="py-1.5 px-3">
              In pipeline
            </Badge>
          )}
          <AddToWatchlistDialog
            entityId={e.id}
            watchlists={userWatchlists}
            trigger={
              <Button size="sm" variant="outline">
                Save to watchlist
              </Button>
            }
          />
        </div>
      </div>

      {!score ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
          This entity hasn&apos;t been scored yet. Scoring runs automatically once it accumulates
          enough signals.
        </div>
      ) : (
        <Tabs defaultValue="overview">
          <TabsList className="mb-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="niches">
              Adjacent Niches{' '}
              {niches.length > 0 && (
                <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 text-xs">
                  {niches.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="signals">Signals</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
          </TabsList>

          {/* ── Overview tab ── */}
          <TabsContent value="overview" className="space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Scores</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <ScoreBar label="Momentum" value={score.momentumScore} />
                <ScoreBar label="Engagement quality" value={score.engagementQualityScore} />
                <ScoreBar label="Distribution gap" value={score.distributionGapScore} />
                <ScoreBar label="Market tailwinds" value={score.marketTailwindsScore} />
                <ScoreBar label="Fundamentals" value={score.fundamentalsScore} />
                <ScoreBar label="Execution feasibility" value={score.executionFeasibilityScore} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Why this score</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed">{score.reasoning}</p>
              </CardContent>
            </Card>

            {redFlags.length > 0 && (
              <Card className="border-destructive/30">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base text-destructive">Red flags</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1">
                    {redFlags.map((flag, i) => (
                      <li key={i} className="text-sm flex gap-2">
                        <span className="text-destructive mt-0.5 shrink-0">⚠</span>
                        <span>{flag}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {evidence.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Evidence</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {evidence.map((ev, i) => (
                    <div key={i} className="text-sm border-l-2 border-muted pl-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium">{ev.source}</span>
                        <SignalBadge type={ev.signal_type} />
                      </div>
                      <p className="text-muted-foreground">{ev.snippet}</p>
                      {ev.url && (
                        <a
                          href={ev.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 mt-1 inline-block truncate max-w-full"
                        >
                          {ev.url}
                        </a>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            <div className="text-xs text-muted-foreground">
              Scored{' '}
              {new Date(score.asOf).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              · {score.model} · prompt {score.promptVersion}
            </div>
          </TabsContent>

          {/* ── Adjacent Niches tab ── */}
          <TabsContent value="niches" className="space-y-4">
            {niches.length === 0 ? (
              <p className="text-sm text-muted-foreground">No adjacent niches in this score.</p>
            ) : (
              niches.map((niche, i) => (
                <Card key={i}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle className="text-base">{niche.niche}</CardTitle>
                      <DifficultyBadge difficulty={niche.estimated_difficulty} />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div>
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                        Why underserved
                      </div>
                      <p>{niche.rationale}</p>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                        Why it could win
                      </div>
                      <p>{niche.why_it_could_win}</p>
                    </div>
                    <div className="rounded-md bg-primary/5 border border-primary/20 px-3 py-2">
                      <div className="text-xs font-medium text-primary uppercase tracking-wide mb-1">
                        Suggested angle
                      </div>
                      <p className="font-medium">{niche.suggested_angle}</p>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          {/* ── Signals tab ── */}
          <TabsContent value="signals">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Signal history — last 30 days</CardTitle>
              </CardHeader>
              <CardContent>
                <SignalsChart data={signals.data} metrics={signals.metrics} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Notes tab ── */}
          <TabsContent value="notes">
            {pipelineRow ? (
              <NotesEditor
                pipelineItemId={pipelineRow.id}
                initialNotes={pipelineRow.notes}
              />
            ) : (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                <p>Notes are saved per pipeline entry.</p>
                <p className="mt-1">
                  Use &ldquo;Add to Pipeline&rdquo; above to start tracking this opportunity and
                  adding notes.
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
