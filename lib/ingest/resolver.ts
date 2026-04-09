import { db as defaultDb } from '@/lib/db'
import { entity } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import type { Database } from '@/lib/db'

export type ResolveInput = {
  name: string
  url?: string
  description?: string
  category?: string
  externalIds: Record<string, string>
  metadata?: Record<string, unknown>
}

function extractDomain(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    const { hostname } = new URL(url)
    return hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}

function generateSlug(input: ResolveInput): string {
  const preferredSources = ['hackernews', 'producthunt', 'github', 'reddit', 'x-twitter']
  for (const src of preferredSources) {
    if (input.externalIds[src]) {
      return `${src}:${input.externalIds[src]}`
    }
  }
  return input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100)
}

/**
 * Resolves an entity using 5 ordered strategies:
 * 1. Exact external_ids match (jsonb containment)
 * 2. Exact domain match
 * 3. (GitHub) — covered by strategy 1 via externalIds.github
 * 4. Fuzzy name match via pg_trgm (similarity > 0.85), gracefully degrades if extension missing
 * 5. Create new entity
 *
 * On match: merges new externalIds and updates last_seen_at.
 * Returns the entity id.
 */
export async function resolveEntity(
  input: ResolveInput,
  dbClient: Database = defaultDb
): Promise<string> {
  const domain = extractDomain(input.url)

  // The full external ID map we'll store (includes domain derived from URL)
  const fullExternalIds: Record<string, string> = {
    ...input.externalIds,
    ...(domain ? { domain } : {}),
  }

  // --- Strategy 1: exact external_ids match ---
  for (const [key, value] of Object.entries(input.externalIds)) {
    const matches = await dbClient
      .select()
      .from(entity)
      .where(sql`${entity.externalIds} @> ${JSON.stringify({ [key]: value })}::jsonb`)
      .limit(1)
    if (matches.length > 0) {
      await updateEntity(dbClient, matches[0].id, fullExternalIds)
      return matches[0].id
    }
  }

  // --- Strategy 2: exact domain match ---
  if (domain) {
    const matches = await dbClient
      .select()
      .from(entity)
      .where(sql`${entity.externalIds} @> ${JSON.stringify({ domain })}::jsonb`)
      .limit(1)
    if (matches.length > 0) {
      await updateEntity(dbClient, matches[0].id, fullExternalIds)
      return matches[0].id
    }
  }

  // --- Strategy 4: fuzzy name match (pg_trgm, similarity > 0.85) ---
  // Strategy 3 (GitHub repo) is handled by strategy 1 via externalIds.github
  try {
    const whereClause = input.category
      ? and(
          sql`similarity(${entity.name}, ${input.name}) > 0.85`,
          eq(entity.category, input.category)
        )
      : sql`similarity(${entity.name}, ${input.name}) > 0.85`

    const matches = await dbClient
      .select()
      .from(entity)
      .where(whereClause)
      .orderBy(sql`similarity(${entity.name}, ${input.name}) DESC`)
      .limit(1)

    if (matches.length > 0) {
      await updateEntity(dbClient, matches[0].id, fullExternalIds)
      return matches[0].id
    }
  } catch {
    // pg_trgm extension not enabled — skip fuzzy match and fall through to create
  }

  // --- Strategy 5: create new entity ---
  const [created] = await dbClient
    .insert(entity)
    .values({
      slug: generateSlug(input),
      name: input.name,
      description: input.description,
      url: input.url,
      category: input.category,
      externalIds: fullExternalIds,
      metadata: input.metadata ?? {},
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    })
    .returning()

  return created.id
}

async function updateEntity(
  dbClient: Database,
  id: string,
  newExternalIds: Record<string, string>
): Promise<void> {
  await dbClient
    .update(entity)
    .set({
      lastSeenAt: new Date(),
      // COALESCE guards against NULL; || merges the jsonb objects (right-hand wins on conflict)
      externalIds: sql<Record<string, string>>`COALESCE(${entity.externalIds}, '{}'::jsonb) || ${JSON.stringify(newExternalIds)}::jsonb`,
    })
    .where(eq(entity.id, id))
}
