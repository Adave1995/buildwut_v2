import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default async function SettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Account</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{user?.email ?? '—'}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Export</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Download all scored opportunities as a CSV file.
          </p>
          <a href="/api/exports/opportunities.csv" download>
            <Button size="sm" variant="secondary">
              Download opportunities.csv
            </Button>
          </a>
        </CardContent>
      </Card>
    </div>
  )
}
