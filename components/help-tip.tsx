'use client'

import { useState, useRef, useEffect } from 'react'
import { HelpCircle } from 'lucide-react'
import { useHelp } from '@/lib/help-context'

export function HelpTip({ title, content }: { title: string; content: string }) {
  const { helpEnabled } = useHelp()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  if (!helpEnabled) return null

  return (
    <div className="relative inline-flex items-center shrink-0" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className="size-5 rounded-full flex items-center justify-center text-primary/60 hover:text-primary hover:bg-primary/10 transition-colors"
        aria-label={`Help: ${title}`}
      >
        <HelpCircle className="size-4" />
      </button>
      {open && (
        <div
          className="absolute left-0 top-7 z-50 w-72 rounded-lg border bg-card p-3 shadow-lg text-card-foreground"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="font-semibold text-sm mb-1.5">{title}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{content}</p>
        </div>
      )}
    </div>
  )
}
