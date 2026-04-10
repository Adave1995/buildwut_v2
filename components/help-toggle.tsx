'use client'

import { HelpCircle } from 'lucide-react'
import { useHelp } from '@/lib/help-context'

export function HelpToggle() {
  const { helpEnabled, toggleHelp } = useHelp()

  return (
    <button
      type="button"
      onClick={toggleHelp}
      className={`flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm transition-colors ${
        helpEnabled
          ? 'text-primary bg-primary/10 hover:bg-primary/15'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
      }`}
    >
      <HelpCircle className="size-4 shrink-0" />
      {helpEnabled ? 'Help on' : 'Help'}
    </button>
  )
}
