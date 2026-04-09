import { describe, it, expect, vi } from 'vitest'
import type { Mock } from 'vitest'
import { resolveEntity } from './resolver'

// Prevent the default db import from trying to connect
vi.mock('@/lib/db', () => ({ db: {} }))

type MockRow = { id: string; externalIds: Record<string, string> }

type DbMock = {
  select: Mock
  insert: Mock
  update: Mock
  _selectChain: { from: Mock; where: Mock; orderBy: Mock; limit: Mock }
  _insertChain: { values: Mock; returning: Mock }
  _updateChain: { set: Mock; where: Mock }
}

/**
 * Build a lightweight mock of the Drizzle db client.
 * `limitResponses` is consumed in order — each .limit() call pops the next array.
 */
function makeDb(limitResponses: MockRow[][] = []): DbMock {
  let callCount = 0

  const mockLimit = vi.fn().mockImplementation(() => {
    const response = limitResponses[callCount] ?? []
    callCount++
    return Promise.resolve(response)
  })

  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: mockLimit,
  }

  const mockReturning = vi.fn().mockResolvedValue([{ id: 'new-entity-id', externalIds: {} }])
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    returning: mockReturning,
  }

  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  }

  return {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue(insertChain),
    update: vi.fn().mockReturnValue(updateChain),
    _selectChain: selectChain,
    _insertChain: insertChain,
    _updateChain: updateChain,
  } as DbMock
}

describe('resolveEntity', () => {
  describe('strategy 1 — exact external_ids match', () => {
    it('returns the matched entity id', async () => {
      const db = makeDb([[{ id: 'entity-1', externalIds: { hackernews: '123' } }]])
      const id = await resolveEntity({ name: 'My App', externalIds: { hackernews: '123' } }, db as never)
      expect(id).toBe('entity-1')
    })

    it('calls update to merge externalIds and refresh last_seen_at', async () => {
      const db = makeDb([[{ id: 'entity-1', externalIds: { hackernews: '123' } }]])
      await resolveEntity(
        { name: 'My App', url: 'https://myapp.com', externalIds: { hackernews: '123' } },
        db as never,
      )
      expect(db._updateChain.set).toHaveBeenCalled()
    })

    it('tries each external_id key in order and returns on first match', async () => {
      // Two keys; first key misses, second hits
      const db = makeDb([
        [], // hackernews miss
        [{ id: 'entity-2', externalIds: { github: 'org/repo' } }], // github hit
      ])
      const id = await resolveEntity(
        { name: 'My App', externalIds: { hackernews: '456', github: 'org/repo' } },
        db as never,
      )
      expect(id).toBe('entity-2')
    })
  })

  describe('strategy 2 — exact domain match', () => {
    it('matches by domain when no external_id match exists', async () => {
      // externalIds empty → strategy 1 skipped; domain check is first DB call
      const db = makeDb([[{ id: 'entity-3', externalIds: { domain: 'myapp.com' } }]])
      const id = await resolveEntity(
        { name: 'My App', url: 'https://myapp.com', externalIds: {} },
        db as never,
      )
      expect(id).toBe('entity-3')
    })

    it('strips www. from domain before matching', async () => {
      const db = makeDb([[{ id: 'entity-4', externalIds: { domain: 'myapp.com' } }]])
      const id = await resolveEntity(
        { name: 'My App', url: 'https://www.myapp.com', externalIds: {} },
        db as never,
      )
      expect(id).toBe('entity-4')
    })

    it('skips domain check when url is absent', async () => {
      // No url, no externalIds → only fuzzy (first DB call)
      const db = makeDb([[{ id: 'entity-5', externalIds: {} }]])
      const id = await resolveEntity({ name: 'My App', externalIds: {} }, db as never)
      // Fuzzy match returns entity-5
      expect(id).toBe('entity-5')
      // Should only have been called once (fuzzy), not twice
      expect(db._selectChain.limit).toHaveBeenCalledTimes(1)
    })
  })

  describe('strategy 4 — fuzzy name match', () => {
    it('matches by name similarity when id and domain checks miss', async () => {
      // external_id miss, domain miss, fuzzy hit
      const db = makeDb([
        [], // hackernews miss
        [], // domain miss
        [{ id: 'entity-6', externalIds: {} }], // fuzzy hit
      ])
      const id = await resolveEntity(
        { name: 'My App', url: 'https://otherdomain.com', externalIds: { hackernews: '999' } },
        db as never,
      )
      expect(id).toBe('entity-6')
    })

    it('falls through to create when pg_trgm is not enabled', async () => {
      // No externalIds, no url → strategy 4 is the first (and only) select call; make it throw
      const db = makeDb([])
      db._selectChain.limit.mockRejectedValueOnce(new Error('function similarity does not exist'))
      const id = await resolveEntity({ name: 'Brand New Thing', externalIds: {} }, db as never)
      expect(id).toBe('new-entity-id')
      expect(db.insert).toHaveBeenCalled()
    })
  })

  describe('strategy 5 — create new entity', () => {
    it('creates a new entity when all strategies miss', async () => {
      const db = makeDb([[], [], []])
      const id = await resolveEntity(
        { name: 'Totally New App', url: 'https://new.com', externalIds: { hackernews: '111' } },
        db as never,
      )
      expect(id).toBe('new-entity-id')
      expect(db.insert).toHaveBeenCalled()
      expect(db._insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Totally New App',
          url: 'https://new.com',
        }),
      )
    })

    it('includes domain in stored externalIds', async () => {
      const db = makeDb([[], []])
      await resolveEntity(
        { name: 'App', url: 'https://app.io', externalIds: {} },
        db as never,
      )
      expect(db._insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          externalIds: expect.objectContaining({ domain: 'app.io' }),
        }),
      )
    })

    it('uses hackernews:id slug when hackernews id is provided', async () => {
      const db = makeDb([[]])
      await resolveEntity(
        { name: 'Show HN: My App', externalIds: { hackernews: '42' } },
        db as never,
      )
      expect(db._insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'hackernews:42' }),
      )
    })
  })
})
