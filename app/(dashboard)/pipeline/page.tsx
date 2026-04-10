import { db } from '@/lib/db'
import { pipelineItem, entity } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { PipelineBoard } from '@/components/pipeline-board'
import { HelpTip } from '@/components/help-tip'

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
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">Pipeline</h1>
          <HelpTip
            title="Your Pipeline"
            content="A personal Kanban board for tracking opportunities you're actively evaluating. Add opportunities here from the Feed or any opportunity detail page using '+Pipeline'. Drag cards between stages as your thinking progresses. Click an opportunity to open its detail page and write notes under the Notes tab."
          />
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Drag cards between stages to track your progress
        </p>
      </div>
      <PipelineBoard items={items} />
    </div>
  )
}
