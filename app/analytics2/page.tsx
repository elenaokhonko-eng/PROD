import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SiteHeader } from '@/components/site-header'
import { getCurrentUser } from '@/lib/auth'
import { BROWSER_STEPS, type Split } from '@/lib/server/analytics2'
import { loadAnalytics2 } from '@/lib/server/analytics2-load'
import { createUserClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

// Analytics 2 (Elena, 14 Nov 2026): the top-down view of the journey, from the first visit to a delivered evaluation and
// the packs. Analytics 1 (/analytics) stays the detailed view. Admins only; everyone else gets a 404.
export const metadata: Metadata = { title: 'Analytics 2 · Journey' }
export const dynamic = 'force-dynamic'

const PERIODS = [7, 30] as const
const number = (value: number) => new Intl.NumberFormat('en-SG').format(value)
const percent = (value: number | null) => (value === null ? '—' : `${value}%`)
const duration = (minutes: number | null) => {
  if (minutes === null) return '—'
  if (minutes < 60) return `${Math.round(minutes)} min`
  if (minutes < 48 * 60) return `${Math.round((minutes / 60) * 10) / 10} h`
  return `${Math.round((minutes / 1440) * 10) / 10} days`
}

function SplitTable({ split, columns }: { split: Split; columns: { key: string; label: string }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="mb-2 text-left font-semibold">{split.dimension}</caption>
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th scope="col" className="py-2 pr-4 font-medium">{split.dimension}</th>
            {columns.map((column) => (
              <th key={column.key} scope="col" className="py-2 pr-4 text-right font-medium">{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {split.rows.length ? (
            split.rows.map((row) => (
              <tr key={row.value} className="border-b last:border-0">
                <th scope="row" className="py-2 pr-4 text-left font-normal">{row.value}</th>
                {columns.map((column) => (
                  <td key={column.key} className="py-2 pr-4 text-right tabular-nums">{number(row.counts[column.key] ?? 0)}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length + 1} className="py-3 text-muted-foreground">No data in this period yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export default async function Analytics2Page({ searchParams }: { searchParams: { days?: string } }) {
  const currentUser = await getCurrentUser()
  if (!currentUser) notFound()
  const userClient = await createUserClient()
  const { data: isAdmin, error: roleError } = await userClient.rpc('current_app_has_role', { p_role: 'admin' })
  if (roleError || !isAdmin) notFound()

  const days = PERIODS.find((period) => String(period) === searchParams.days) ?? 30
  const { view, missing } = await loadAnalytics2(createServiceClient(), days)
  const stepColumns = BROWSER_STEPS.map(({ key, label }) => ({ key, label }))
  const evaluationColumns = [
    { key: 'cases', label: 'Cases' },
    { key: 'evaluations', label: 'Evaluations delivered' },
  ]

  return (
    <main className="min-h-screen bg-background">
      <SiteHeader />
      <div className="border-b border-border/50 bg-card/50">
        <div className="container mx-auto space-y-3 px-4 py-8">
          <Badge variant="outline" className="rounded-full">Analytics 2</Badge>
          <h1 className="text-4xl font-bold text-balance">The journey, top down</h1>
          <p className="max-w-3xl text-muted-foreground">
            From the first visit to a delivered evaluation and the packs, over the last {days} days. Steps before sign-up are
            counted per browser tab; later steps come from accounts, cases, evaluations, the waitlist and purchases. Only
            totals are shown. For page-level detail, see <Link href="/analytics" className="underline">Analytics 1</Link>.
          </p>
          <nav aria-label="Period" className="flex gap-2">
            {PERIODS.map((period) => (
              <Link
                key={period}
                href={`/analytics2?days=${period}`}
                aria-current={period === days ? 'page' : undefined}
                className="rounded-full border px-3 py-1 text-sm aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground"
              >
                Last {period} days
              </Link>
            ))}
          </nav>
          {missing.length ? (
            <p role="status" className="text-sm text-destructive">Not available right now: {missing.join(', ')}.</p>
          ) : null}
        </div>
      </div>

      <div className="container mx-auto space-y-8 px-4 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Journey steps</CardTitle>
            <CardDescription>
              The share is of the step above it. Interest and purchases are shares of evaluations delivered.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">Step</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Recorded from</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Count</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {view.steps.map((step) => (
                  <tr key={step.key} className="border-b last:border-0">
                    <th scope="row" className="py-2 pr-4 text-left font-normal">{step.label}</th>
                    <td className="py-2 pr-4 text-muted-foreground">{step.source === 'browser' ? 'Browser tabs' : 'Records'}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{number(step.count)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{percent(step.fromPrevious)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          {view.dropOff.map((item) => (
            <Card key={item.label}>
              <CardHeader>
                <CardTitle className="text-base">{item.label}</CardTitle>
                <CardDescription>Browser tabs, before sign-up finished.</CardDescription>
              </CardHeader>
              <CardContent className="text-3xl font-bold tabular-nums">
                {number(item.count)} <span className="text-base font-normal text-muted-foreground">of {number(item.of)}</span>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Journey times</CardTitle>
            <CardDescription>Median and the slowest quarter (75th percentile), across everyone who did both steps.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">Between</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">People</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Median</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Slowest quarter</th>
                </tr>
              </thead>
              <tbody>
                {view.timings.map((row) => (
                  <tr key={row.label} className="border-b last:border-0">
                    <th scope="row" className="py-2 pr-4 text-left font-normal">{row.label}</th>
                    <td className="py-2 pr-4 text-right tabular-nums">{number(row.count)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{duration(row.medianMinutes)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{duration(row.slowQuarterMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-sm text-muted-foreground">
              Pack delivery times start once the paid packs are live and their delivery is recorded.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Where visitors came from</CardTitle>
            <CardDescription>Browser tabs at each step, by the channel the tab first arrived from.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            {view.splits.map((split) => (
              <SplitTable key={split.dimension} split={split} columns={stepColumns} />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Which channels produced evaluations</CardTitle>
            <CardDescription>Cases created in the period, by the channel recorded once when each case was created.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            {view.evaluationsByChannel.map((split) => (
              <SplitTable key={split.dimension} split={split} columns={evaluationColumns} />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>By day</CardTitle>
            <CardDescription>Newest first.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">Day</th>
                  {stepColumns.map((column) => (
                    <th key={column.key} scope="col" className="py-2 pr-4 text-right font-medium">{column.label}</th>
                  ))}
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Accounts</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Cases</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Evaluations</th>
                </tr>
              </thead>
              <tbody>
                {view.daily.length ? (
                  view.daily.map((row) => (
                    <tr key={row.day} className="border-b last:border-0">
                      <th scope="row" className="py-2 pr-4 text-left font-normal tabular-nums">{row.day}</th>
                      {[...view.browserStepKeys, 'account_created', 'case_created_record', 'evaluation_delivered'].map((key) => (
                        <td key={key} className="py-2 pr-4 text-right tabular-nums">{number(row.counts[key] ?? 0)}</td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9} className="py-3 text-muted-foreground">No data in this period yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
