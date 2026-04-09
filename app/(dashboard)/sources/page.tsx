import { db } from '@/lib/db'
import { sourceRun } from '@/lib/db/schema'
import { getAllSources } from '@/lib/sources/registry'
import { desc } from 'drizzle-orm'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const dynamic = 'force-dynamic'

type SourceRun = typeof sourceRun.$inferSelect

function StatusBadge({ status }: { status: string }) {
  if (status === 'ok') {
    return <Badge className="bg-green-500 text-white hover:bg-green-600">OK</Badge>
  }
  if (status === 'partial') {
    return <Badge className="bg-yellow-500 text-white hover:bg-yellow-600">Partial</Badge>
  }
  return <Badge variant="destructive">Error</Badge>
}

function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHrs = Math.floor(diffMins / 60)
  if (diffHrs < 24) return `${diffHrs}h ago`
  return `${Math.floor(diffHrs / 24)}d ago`
}

async function getLatestRunsPerSource(): Promise<Record<string, SourceRun>> {
  const runs = await db
    .select()
    .from(sourceRun)
    .orderBy(desc(sourceRun.startedAt))
    .limit(500)

  const latest: Record<string, SourceRun> = {}
  for (const run of runs) {
    if (!latest[run.sourceId]) {
      latest[run.sourceId] = run
    }
  }
  return latest
}

export default async function SourcesPage() {
  const sources = getAllSources()
  const latestRuns = await getLatestRunsPerSource()

  const totalEnabled = sources.filter((s) => s.enabled).length
  const lastRunAny = Object.values(latestRuns).sort(
    (a, b) => b.startedAt.getTime() - a.startedAt.getTime()
  )[0]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Sources</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Health dashboard — check here when something breaks.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Sources
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalEnabled}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Sources
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{sources.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Last Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {lastRunAny ? relativeTime(lastRunAny.startedAt) : '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Run</TableHead>
              <TableHead>Items (last run)</TableHead>
              <TableHead>Cadence</TableHead>
              <TableHead>Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.map((source) => {
              const run = latestRuns[source.id]
              return (
                <TableRow key={source.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {source.name}
                      {!source.enabled && (
                        <Badge variant="outline" className="text-xs">
                          disabled
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {run ? (
                      <StatusBadge status={run.status} />
                    ) : (
                      <Badge variant="outline">Never run</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {run ? relativeTime(run.startedAt) : '—'}
                  </TableCell>
                  <TableCell className="text-sm">
                    {run ? run.itemsIngested : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">
                    {source.cadenceCron}
                  </TableCell>
                  <TableCell className="text-xs text-destructive max-w-xs truncate">
                    {run?.errorMessage ?? ''}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
