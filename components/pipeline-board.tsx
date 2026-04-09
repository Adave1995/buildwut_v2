'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  pointerWithin,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Badge } from '@/components/ui/badge'
import { updatePipelineStage, removeFromPipeline } from '@/lib/actions/pipeline'

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

function PipelineCard({
  item,
  ghost = false,
}: {
  item: PipelineRow
  ghost?: boolean
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
      className={`rounded-md border bg-card p-3 text-sm shadow-sm select-none group/card ${ghost ? 'shadow-lg rotate-1 ring-1 ring-foreground/20' : 'cursor-grab active:cursor-grabbing'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/opportunities/${item.entityId}`}
          className="font-medium hover:underline line-clamp-2 flex-1"
          onClick={(e) => e.stopPropagation()}
        >
          {item.entityName}
        </Link>
        {!ghost && (
          <button
            className="shrink-0 opacity-0 group-hover/card:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation()
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
}: {
  stage: (typeof STAGES)[number]
  items: PipelineRow[]
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
          <PipelineCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  )
}

export function PipelineBoard({ items: initialItems }: { items: PipelineRow[] }) {
  const [items, setItems] = useState(initialItems)
  const [activeId, setActiveId] = useState<string | null>(null)

  const activeItem = items.find((i) => i.id === activeId) ?? null

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

    // Validate it's a real stage
    if (!STAGES.find((s) => s.id === newStage)) return

    // Optimistic update
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, stage: newStage } : i)))
    updatePipelineStage(itemId, newStage).catch(() => {
      // Rollback on error
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
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {STAGES.map((stage) => (
          <Column
            key={stage.id}
            stage={stage}
            items={items.filter((i) => i.stage === stage.id)}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeItem ? <PipelineCard item={activeItem} ghost /> : null}
      </DragOverlay>
    </DndContext>
  )
}
