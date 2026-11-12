import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { CostDashboard, CostWindow, SpendLine } from '@/lib/server/cost-dashboard'

// Admin cost page section (cost-controls spec §6 C1): spend from public.model_usage. Numbers, model and purpose names
// and case IDs only.

const usd = (n: number | null) => (n === null ? '—' : `US$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`)
const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(1)}%`)

function Lines({ title, rows }: { title: string; rows: SpendLine[] }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase text-foreground">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No calls</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate">{r.key}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{r.calls} calls · {usd(r.usd)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function WindowCard({ title, data }: { title: string; data: CostWindow }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {usd(data.usd)} across {data.calls} model calls · {data.rateLimited} rate-limited (HTTP 429)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Free evaluations</dt>
            <dd className="text-2xl font-bold tabular-nums">{data.evaluations}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Cost per evaluation</dt>
            <dd className="text-2xl font-bold tabular-nums">{usd(data.costPerEvaluation)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Summary version (fallback) rate</dt>
            <dd className="text-2xl font-bold tabular-nums">{pct(data.fallbackRate)}</dd>
          </div>
        </dl>
        <div className="grid gap-6 md:grid-cols-2">
          <Lines title="By purpose" rows={data.byPurpose} />
          <Lines title="By model" rows={data.byModel} />
        </div>
      </CardContent>
    </Card>
  )
}

export function CostDashboardSection({ data, capUsd }: { data: CostDashboard | null; capUsd: number }) {
  return (
    <section aria-labelledby="model-costs" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="model-costs" className="text-2xl font-semibold">Model costs</h2>
        <Badge variant="outline" className="rounded-full">{data?.environment ?? 'unavailable'}</Badge>
        <span className="text-sm text-muted-foreground">Daily cap {usd(capUsd)} (Singapore day)</span>
      </div>
      {data === null ? (
        <Card role="alert">
          <CardContent className="pt-6 text-sm text-muted-foreground">Model usage could not be loaded.</CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <WindowCard title="Today" data={data.today} />
            <WindowCard title="Last 7 days" data={data.week} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Top cases by spend (last 7 days)</CardTitle>
              <CardDescription>Case IDs only.</CardDescription>
            </CardHeader>
            <CardContent>
              {data.topCases.length === 0 ? (
                <p className="text-sm text-muted-foreground">No case-linked calls</p>
              ) : (
                <ol className="space-y-1 text-sm">
                  {data.topCases.map((c) => (
                    <li key={c.caseId} className="flex items-center justify-between gap-3">
                      <code className="min-w-0 truncate text-xs">{c.caseId}</code>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{c.calls} calls · {usd(c.usd)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </section>
  )
}
