'use client'

import { useState, useTransition, useEffect } from 'react'
import Link from 'next/link'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { X, ExternalLink, ArrowUpRight, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { updatePipelineStage, removeFromPipeline, saveNotes } from '@/lib/actions/pipeline'

export type PipelineRow = {
  id: string
  stage: string
  notes: string | null
  entityId: string
  entityName: string
  entityCategory: string | null
  entityUrl: string | null
}

const STAGES = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'shortlist', label: 'Shortlist' },
  { id: 'investigating', label: 'Investigating' },
  { id: 'building', label: 'Building' },
  { id: 'archived', label: 'Archived' },
] as const

type ScoreData = {
  totalScore: number
  momentumScore: number
  engagementQualityScore: number
  distributionGapScore: number
  marketTailwindsScore: number
  fundamentalsScore: number
  executionFeasibilityScore: number
  reasoning: string
  redFlags: string[] | null
  oneSentencePitch: string | null
}

function MiniScoreBar({ label, value }: { label: string; value: number }) {
  const color =
    value >= 75 ? 'bg-green-500' : value >= 50 ? 'bg-yellow-500' : 'bg-muted-foreground/40'
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="w-6 text-right text-xs tabular-nums text-muted-foreground">{value}</span>
    </div>
  )
}

function PipelineDetailPanel({
  item,
  onClose,
  onNotesUpdated,
}: {
  item: PipelineRow
  onClose: () => void
  onNotesUpdated: (notes: string) => void
}) {
  const [score, setScore] = useState<ScoreData | null>(null)
  const [loadingScore, setLoadingScore] = useState(true)
  const [notes, setNotes] = useState(item.notes ?? '')
  const [notesChanged, setNotesChanged] = useState(false)
  const [saving, startSave] = useTransition()

  useEffect(() => {
    fetch(`/api/opportunities/${item.entityId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.score) setScore(d.score)
        setLoadingScore(false)
      })
      .catch(() => setLoadingScore(false))
  }, [item.entityId])

  function handleSaveNotes() {
    startSave(async () => {
      await saveNotes(item.id, notes)
      setNotesChanged(false)
      onNotesUpdated(notes)
    })
  }

  const stageName = STAGES.find((s) => s.id === item.stage)?.label ?? item.stage

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-base leading-snug">{item.entityName}</h2>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {item.entityCategory && (
              <Badge variant="secondary" className="text-xs">
                {item.entityCategory}
              </Badge>
            )}
            <Badge variant="outline" className="text-xs">
              {stageName}
            </Badge>
          </div>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Close panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Score */}
      {loadingScore ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading score…
        </div>
      ) : score ? (
        <>
          <div className="flex items-center gap-3">
            <div className="text-4xl font-bold tabular-nums leading-none">{score.totalScore}</div>
            <div className="text-xs text-muted-foreground leading-snug">
              total
              <br />
              score
            </div>
          </div>

          {score.oneSentencePitch && (
            <p className="text-sm italic text-muted-foreground leading-relaxed">
              {score.oneSentencePitch}
            </p>
          )}

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Score breakdown
            </p>
            <MiniScoreBar label="Momentum" value={score.momentumScore} />
            <MiniScoreBar label="Engagement" value={score.engagementQualityScore} />
            <MiniScoreBar label="Distribution gap" value={score.distributionGapScore} />
            <MiniScoreBar label="Tailwinds" value={score.marketTailwindsScore} />
            <MiniScoreBar label="Fundamentals" value={score.fundamentalsScore} />
            <MiniScoreBar label="Feasibility" value={score.executionFeasibilityScore} />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Why this score
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">{score.reasoning}</p>
          </div>

          {score.redFlags && score.redFlags.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-destructive">
                Red flags
              </p>
              <ul className="space-y-1">
                {score.redFlags.map((flag, i) => (
                  <li key={i} className="text-sm flex gap-2">
                    <span className="text-destructive mt-0.5 shrink-0">⚠</span>
                    <span>{flag}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No score yet for this opportunity.</p>
      )}

      {/* Notes */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</p>
        <textarea
          className="w-full min-h-[90px] rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="Add your notes…"
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value)
            setNotesChanged(true)
          }}
        />
        {notesChanged && (
          <Button
            size="sm"
            variant="secondary"
            onClick={handleSaveNotes}
            disabled={saving}
            className="w-full"
          >
            {saving ? 'Saving…' : 'Save notes'}
          </Button>
        )}
      </div>

      {/* Links */}
      <div className="flex flex-col gap-2 pt-1 border-t">
        {item.entityUrl && (
          <a
            href={item.entityUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors truncate"
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            {item.entityUrl.replace(/^https?:\/\//, '')}
          </a>
        )}
        <Link
          href={`/opportunities/${item.entityId}`}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
          View full details
        </Link>
      </div>
    </div>
  )
}

function PipelineCard({
  item,
  ghost = false,
  isSelected = false,
  onSelect,
  onWillRemove,
}: {
  item: PipelineRow
  ghost?: boolean
  isSelected?: boolean
  onSelect?: () => void
  onWillRemove?: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    data: { item },
  })
  const [removePending, startRemove] = useTransition()

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.35 : 1,
  }

  return (
    <div
      ref={ghost ? undefined : setNodeRef}
      style={ghost ? undefined : style}
      {...(ghost ? {} : { ...listeners, ...attributes })}
      className={`rounded-md border bg-card p-3 text-sm shadow-sm select-none group/card ${
        ghost
          ? 'shadow-lg rotate-1 ring-1 ring-foreground/20'
          : 'cursor-grab active:cursor-grabbing'
      } ${isSelected ? 'ring-2 ring-primary border-primary/50' : ''}`}
      onClick={(e) => {
        if (!ghost) {
          e.stopPropagation()
          onSelect?.()
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium line-clamp-2 flex-1">{item.entityName}</span>
        {!ghost && (
          <button
            className="shrink-0 opacity-0 group-hover/card:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onWillRemove?.()
              startRemove(async () => {
                await removeFromPipeline(item.id)
              })
            }}
            disabled={removePending}
            aria-label="Remove from pipeline"
          >
            ✕
          </button>
        )}
      </div>
      {item.entityCategory && (
        <Badge variant="secondary" className="mt-1.5 text-xs">
          {item.entityCategory}
        </Badge>
      )}
    </div>
  )
}

function Column({
  stage,
  items,
  selectedEntityId,
  onSelect,
  onWillRemove,
}: {
  stage: (typeof STAGES)[number]
  items: PipelineRow[]
  selectedEntityId: string | null
  onSelect: (entityId: string) => void
  onWillRemove: (entityId: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })

  return (
    <div className="flex flex-col min-w-[200px] w-[200px] shrink-0">
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {stage.label}
        </span>
        <span className="text-xs text-muted-foreground">{items.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 min-h-[120px] rounded-lg border-2 border-dashed p-2 space-y-2 transition-colors ${
          isOver ? 'border-foreground/40 bg-accent/30' : 'border-transparent bg-muted/30'
        }`}
      >
        {items.map((item) => (
          <PipelineCard
            key={item.id}
            item={item}
            isSelected={selectedEntityId === item.entityId}
            onSelect={() => onSelect(item.entityId)}
            onWillRemove={() => onWillRemove(item.entityId)}
          />
        ))}
      </div>
    </div>
  )
}

export function PipelineBoard({ items: initialItems }: { items: PipelineRow[] }) {
  const [items, setItems] = useState(initialItems)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  )

  const activeItem = items.find((i) => i.id === activeId) ?? null
  const selectedItem = selectedEntityId
    ? (items.find((i) => i.entityId === selectedEntityId) ?? null)
    : null

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const { active, over } = event
    if (!over) return

    const itemId = active.id as string
    const newStage = over.id as string
    const item = items.find((i) => i.id === itemId)
    if (!item || item.stage === newStage) return

    if (!STAGES.find((s) => s.id === newStage)) return

    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, stage: newStage } : i)))
    updatePipelineStage(itemId, newStage).catch(() => {
      setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, stage: item.stage } : i)))
    })
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <p className="font-medium">Pipeline is empty</p>
        <p className="text-sm text-muted-foreground mt-1">
          Add opportunities from the{' '}
          <Link href="/feed" className="underline underline-offset-2">
            feed
          </Link>{' '}
          to start tracking them.
        </p>
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-0 items-start">
        {/* Kanban board — compacts when panel is open */}
        <div className="flex-1 min-w-0 overflow-x-auto">
          <div className="flex gap-4 pb-4">
            {STAGES.map((stage) => (
              <Column
                key={stage.id}
                stage={stage}
                items={items.filter((i) => i.stage === stage.id)}
                selectedEntityId={selectedEntityId}
                onSelect={(entityId) =>
                  setSelectedEntityId((prev) => (prev === entityId ? null : entityId))
                }
                onWillRemove={(entityId) => {
                  if (selectedEntityId === entityId) setSelectedEntityId(null)
                }}
              />
            ))}
          </div>
        </div>

        {/* Detail panel — slides in from right */}
        <div
          className={`shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out self-start sticky top-6 ${
            selectedItem ? 'w-[400px]' : 'w-0'
          }`}
        >
          <div className="w-[400px] pl-6 border-l overflow-y-auto max-h-[calc(100vh-4rem)]">
            {selectedItem && (
              <PipelineDetailPanel
                key={selectedItem.entityId}
                item={selectedItem}
                onClose={() => setSelectedEntityId(null)}
                onNotesUpdated={(updated) =>
                  setItems((prev) =>
                    prev.map((i) =>
                      i.entityId === selectedEntityId ? { ...i, notes: updated } : i
                    )
                  )
                }
              />
            )}
          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeItem ? <PipelineCard item={activeItem} ghost /> : null}
      </DragOverlay>
    </DndContext>
  )
}
