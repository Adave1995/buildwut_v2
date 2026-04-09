import Link from 'next/link'
import { LayoutDashboard, Kanban, Bookmark, Rss, Settings } from 'lucide-react'

const navItems = [
  { href: '/feed', label: 'Feed', icon: LayoutDashboard },
  { href: '/pipeline', label: 'Pipeline', icon: Kanban },
  { href: '/watchlists', label: 'Watchlists', icon: Bookmark },
  { href: '/sources', label: 'Sources', icon: Rss },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export function NavSidebar() {
  return (
    <aside className="w-56 shrink-0 border-r bg-card flex flex-col py-6">
      <div className="px-4 mb-6">
        <span className="font-bold text-lg tracking-tight">BuildWut</span>
      </div>
      <nav className="flex-1 space-y-1 px-2">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <item.icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
