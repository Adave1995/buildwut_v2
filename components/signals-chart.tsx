'use client'

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'

type DataPoint = {
  t: string // ISO date string
  [metricName: string]: number | string
}

const COLORS = [
  '#6366f1',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#3b82f6',
  '#a855f7',
  '#14b8a6',
]

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatMetricName(name: string) {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function SignalsChart({
  data,
  metrics,
}: {
  data: DataPoint[]
  metrics: string[]
}) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        No signal data yet for this entity.
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="t"
          tickFormatter={formatDate}
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={36} />
        <Tooltip
          labelFormatter={(v) => formatDate(String(v))}
          contentStyle={{ fontSize: 12 }}
        />
        <Legend formatter={formatMetricName} wrapperStyle={{ fontSize: 12 }} />
        {metrics.map((name, i) => (
          <Line
            key={name}
            type="monotone"
            dataKey={name}
            stroke={COLORS[i % COLORS.length]}
            dot={false}
            strokeWidth={2}
            name={name}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
