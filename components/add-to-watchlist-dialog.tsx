'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { addToWatchlist, createWatchlist } from '@/lib/actions/watchlist'

type Watchlist = { id: string; name: string }

export function AddToWatchlistDialog({
  entityId,
  watchlists,
  trigger,
}: {
  entityId: string
  watchlists: Watchlist[]
  trigger: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()

  function handleAdd(watchlistId: string) {
    startTransition(async () => {
      await addToWatchlist(watchlistId, entityId)
      setAdded((prev) => new Set([...prev, watchlistId]))
    })
  }

  function handleCreate() {
    if (!newName.trim()) return
    startTransition(async () => {
      const created = await createWatchlist(newName.trim())
      await addToWatchlist(created.id, entityId)
      setAdded((prev) => new Set([...prev, created.id]))
      setNewName('')
      setCreating(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Save to watchlist</DialogTitle>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {watchlists.length === 0 && !creating && (
            <p className="text-sm text-muted-foreground">No watchlists yet.</p>
          )}
          {watchlists.map((wl) => (
            <div key={wl.id} className="flex items-center justify-between gap-2">
              <span className="text-sm truncate">{wl.name}</span>
              <Button
                size="sm"
                variant={added.has(wl.id) ? 'outline' : 'secondary'}
                className="shrink-0 h-7 text-xs"
                onClick={() => handleAdd(wl.id)}
                disabled={pending || added.has(wl.id)}
              >
                {added.has(wl.id) ? 'Saved ✓' : 'Save'}
              </Button>
            </div>
          ))}

          {creating ? (
            <div className="flex gap-2 pt-1">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Watchlist name"
                className="h-8 text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate()
                  if (e.key === 'Escape') setCreating(false)
                }}
                autoFocus
              />
              <Button size="sm" className="h-8" onClick={handleCreate} disabled={pending}>
                Create
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground w-full justify-start"
              onClick={() => setCreating(true)}
            >
              + New watchlist
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
