import { NavSidebar } from '@/components/nav-sidebar'
import { HelpProvider } from '@/lib/help-context'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <HelpProvider>
      <div className="flex min-h-screen">
        <NavSidebar />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </HelpProvider>
  )
}
