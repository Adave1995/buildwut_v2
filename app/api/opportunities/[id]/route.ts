import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { entity, scoreSnapshot } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [entityRow] = await db.select().from(entity).where(eq(entity.id, id)).limit(1)
  if (!entityRow) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [score] = await db
    .select()
    .from(scoreSnapshot)
    .where(eq(scoreSnapshot.entityId, id))
    .orderBy(desc(scoreSnapshot.asOf))
    .limit(1)

  return NextResponse.json({ entity: entityRow, score: score ?? null })
}
