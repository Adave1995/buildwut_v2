'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { addToPipeline } from '@/lib/actions/pipeline'
import { hideEntity } from '@/lib/actions/feed'
import type { AdjacentNiche } from '@/lib/db/schema'

export type FeedCardRow = {
  scoreId: string
  totalScore: number
  momentumScore: number
  distributionGapScore: number
  executionFeasibilityScore: number
  oneSentencePitch: string | null
  adjacentNiches: unknown
  asOf: Date
  entityId: string
  entityName: string
  entityUrl: string | null
  entityCategory: string | null
}

function ScoreCircle({ score }: { score: number }) {
  const color =
    score >= 75 ? 'text-green-600' : score >= 50 ? 'text-yellow-600' : 'text-muted-foreground'
  return (
    <div className={`text-3xl font-bold tabular-nums leading-none ${color}`}>
      {score}
      <span className="text-sm font-normal text-muted-foreground">/100</span>
    </div>
  )
}

function SubScorePill({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </span>
  )
}

export function FeedCard({
  row,
  isInPipeline: initialInPipeline,
}: {
  row: FeedCardRow
  isInPipeline: boolean
}) {
  const router = useRouter()
  const [hidden, setHidden] = useState(false)
  const [inPipeline, setInPipeline] = useState(initialInPipeline)
  const [addPending, startAdd] = useTransition()
  const [hidePending, startHide] = useTransition()

  if (hidden) return null

  const topNiche = (row.adjacentNiches as AdjacentNiche[] | null)?.[0]

  function handleCardClick() {
    router.push(`/opportunities/${row.entityId}`)
  }

  function handleAddToPipeline(e: React.MouseEvent) {
    e.stopPropagation()
    if (inPipeline) return
    startAdd(async () => {
      await addToPipeline(row.entityId)
      setInPipeline(true)
    })
  }

  function handleHide(e: React.MouseEvent) {
    e.stopPropagation()
    startHide(async () => {
      setHidden(true)
      await hideEntity(row.entityId)
    })
  }

  return (
    <Card
      className="hover:border-foreground/30 transition-colors cursor-pointer group relative"
      onClick={handleCardClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-semibold text-base leading-tight truncate">{row.entityName}</h2>
              {row.entityCategory && (
                <Badge variant="secondary" className="text-xs shrink-0">
                  {row.entityCategory}
                </Badge>
              )}
            </div>
            {row.oneSentencePitch && (
              <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                {row.oneSentencePitch}
              </p>
            )}
          </div>
          <ScoreCircle score={row.totalScore} />
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="flex items-center gap-4 mb-3">
          <SubScorePill label="momentum" value={row.momentumScore} />
          <SubScorePill label="dist. gap" value={row.distributionGapScore} />
          <SubScorePill label="feasibility" value={row.executionFeasibilityScore} />
        </div>

        {topNiche && (
          <div className="rounded-md bg-muted/60 px-3 py-2 text-xs">
            <span className="font-medium text-foreground">Adjacent niche: </span>
            <span className="text-muted-foreground">
              {topNiche.niche} — {topNiche.suggested_angle}
            </span>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          {row.entityUrl && (
            <span className="truncate max-w-[200px]" title={row.entityUrl}>
              {row.entityUrl.replace(/^https?:\/\//, '')}
            </span>
          )}
          <span className="ml-auto shrink-0">
            {new Date(row.asOf).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        </div>
      </CardContent>

      {/* Action buttons — visible on hover */}
      <div
        className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        {inPipeline ? (
          <Badge variant="outline" className="text-xs py-1">
            In pipeline
          </Badge>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            className="h-7 text-xs"
            onClick={handleAddToPipeline}
            disabled={addPending}
          >
            + Pipeline
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-muted-foreground"
          onClick={handleHide}
          disabled={hidePending}
        >
          Hide
        </Button>
      </div>
    </Card>
  )
}
