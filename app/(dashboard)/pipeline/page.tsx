import { db } from '@/lib/db'
import { pipelineItem, entity } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { PipelineBoard } from '@/components/pipeline-board'

async function getPipelineItems(userId: string) {
  return db
    .select({
      id: pipelineItem.id,
      stage: pipelineItem.stage,
      notes: pipelineItem.notes,
      entityId: entity.id,
      entityName: entity.name,
      entityCategory: entity.category,
      entityUrl: entity.url,
    })
    .from(pipelineItem)
    .innerJoin(entity, eq(pipelineItem.entityId, entity.id))
    .where(eq(pipelineItem.userId, userId))
    .orderBy(pipelineItem.createdAt)
}

export default async function PipelinePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const items = user ? await getPipelineItems(user.id) : []

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Pipeline</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Drag cards between stages to track your progress
        </p>
      </div>
      <PipelineBoard items={items} />
    </div>
  )
}
