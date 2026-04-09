'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createWatchlist, deleteWatchlist } from '@/lib/actions/watchlist'

export type WatchlistRow = {
  id: string
  name: string
  entityCount: number
}

export function WatchlistsClient({ initial }: { initial: WatchlistRow[] }) {
  const router = useRouter()
  const [lists, setLists] = useState(initial)
  const [newName, setNewName] = useState('')
  const [creating, startCreate] = useTransition()
  const [deleting, startDelete] = useTransition()

  function handleCreate() {
    if (!newName.trim()) return
    startCreate(async () => {
      await createWatchlist(newName.trim())
      setNewName('')
      router.refresh()
    })
  }

  function handleDelete(id: string) {
    startDelete(async () => {
      await deleteWatchlist(id)
      setLists((prev) => prev.filter((wl) => wl.id !== id))
    })
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Watchlists</h1>
          <p className="text-sm text-muted-foreground mt-1">Saved collections of opportunities</p>
        </div>
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New watchlist name"
            className="h-9 w-48 text-sm"
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <Button size="sm" onClick={handleCreate} disabled={creating || !newName.trim()}>
            Create
          </Button>
        </div>
      </div>

      {lists.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="font-medium">No watchlists yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Create a watchlist above, then save opportunities to it from their detail page.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lists.map((wl) => (
            <Card key={wl.id} className="group hover:border-foreground/30 transition-colors">
              <CardHeader className="pb-1">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/watchlists/${wl.id}`}
                    className="font-semibold hover:underline truncate"
                  >
                    {wl.name}
                  </Link>
                  <button
                    className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(wl.id)}
                    disabled={deleting}
                  >
                    Delete
                  </button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm text-muted-foreground">
                  {wl.entityCount} {wl.entityCount === 1 ? 'opportunity' : 'opportunities'}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
