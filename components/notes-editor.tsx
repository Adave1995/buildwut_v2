'use client'

import { useState, useTransition } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { saveNotes } from '@/lib/actions/pipeline'

export function NotesEditor({
  pipelineItemId,
  initialNotes,
}: {
  pipelineItemId: string
  initialNotes: string | null
}) {
  const [value, setValue] = useState(initialNotes ?? '')
  const [saved, setSaved] = useState(true)
  const [pending, startTransition] = useTransition()

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value)
    setSaved(false)
  }

  function handleSave() {
    startTransition(async () => {
      await saveNotes(pipelineItemId, value)
      setSaved(true)
    })
  }

  return (
    <div className="space-y-3">
      <Textarea
        value={value}
        onChange={handleChange}
        placeholder="Add notes about this opportunity…"
        className="min-h-[160px] resize-y font-mono text-sm"
      />
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={handleSave} disabled={pending || saved}>
          {pending ? 'Saving…' : saved ? 'Saved' : 'Save notes'}
        </Button>
        {saved && !pending && value && (
          <span className="text-xs text-muted-foreground">Up to date</span>
        )}
      </div>
    </div>
  )
}
