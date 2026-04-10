'use client'

import { createContext, useContext, useState } from 'react'

type HelpContextValue = {
  helpEnabled: boolean
  toggleHelp: () => void
}

const HelpContext = createContext<HelpContextValue>({
  helpEnabled: false,
  toggleHelp: () => {},
})

export function useHelp() {
  return useContext(HelpContext)
}

function readStorage(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem('buildwut-help') === 'true'
}

export function HelpProvider({ children }: { children: React.ReactNode }) {
  const [helpEnabled, setHelpEnabled] = useState(readStorage)

  function toggleHelp() {
    setHelpEnabled((prev) => {
      const next = !prev
      localStorage.setItem('buildwut-help', String(next))
      return next
    })
  }

  return (
    <HelpContext.Provider value={{ helpEnabled, toggleHelp }}>
      {children}
    </HelpContext.Provider>
  )
}
