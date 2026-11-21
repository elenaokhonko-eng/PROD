import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { createServiceClient } from "@/lib/supabase/service"
import { SiteHeader } from "@/components/site-header"
import { getCurrentUser } from "@/lib/auth"
import { createUserClient } from "@/lib/supabase/server"
import { CostDashboardSection } from "@/components/harbor/cost-dashboard"
import { type CostDashboard, type CostDashboardClient, loadCostDashboard } from "@/lib/server/cost-dashboard"
import { dailyCapUsd, usageEnvironment } from "@/lib/server/model-usage"
import {
  GRANULARITIES,
  type EventRow,
  countryRows,
  funnelRow,
  periodRows,
  sessionCounts as dailySessionCounts,
  sessionRows,
} from "@/lib/server/analytics1"

export const metadata: Metadata = {
  title: "Analytics | GuideBuoy AI",
  description: "Live metrics from Supabase tables: sessions, engagement, funnels, registrations, and waitlist.",
}

export const dynamic = "force-dynamic"

type Metrics = {
  totalEvents: number
  uniqueSessions: number
  repeatSessions: number
  avgEventsPerSession: number
  countryCounts: Record<string, number>
  registeredUsers: number | null
  waitlistUsers: number | null
  complaintsPending: number | null
  complaintsCompleted: number | null
  reportsPending: number | null
  reportsCompleted: number | null
  avgStoryToSignupMinutes: number | null
  avgSignupToDocsMinutes: number | null
  avgDocsToReportMinutes: number | null
  avgReportToDownloadMinutes: number | null
}

const EVENT_DAYS = 365
const PAGE = 1000
const REPORT_DONE = ["COMPLETED", "EXPORTED", "RESOLVED"]

// The last year's events, a page at a time (the API returns at most 1000 rows per request). Only the country fields
// of event_data are read.
async function fetchEvents(): Promise<EventRow[] | null> {
  const supabase = createServiceClient()
  const since = new Date(Date.now() - EVENT_DAYS * 86_400_000).toISOString()
  const rows: EventRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("analytics_events")
      .select(
        "session_id,user_id,event_name,created_at,ip_country:event_data->>ip_country,country:event_data->>country,country_code:event_data->>country_code",
      )
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) {
      console.error("[analytics] failed to load analytics_events:", error.message)
      return null
    }
    rows.push(...((data ?? []) as unknown as EventRow[]))
    if (!data || data.length < PAGE) return rows
  }
}

async function fetchStatusCounts(table: "cases" | "reports", done: string[]) {
  const supabase = createServiceClient()
  const [all, completed] = await Promise.all([
    supabase.from(table).select("id", { count: "exact", head: true }).not("status", "is", null),
    supabase.from(table).select("id", { count: "exact", head: true }).in("status", done),
  ])
  if (all.error || completed.error) {
    console.error(`[analytics] failed to count ${table} by status:`, (all.error ?? completed.error)?.message)
    return { pending: null, completed: null }
  }
  return { pending: (all.count ?? 0) - (completed.count ?? 0), completed: completed.count ?? 0 }
}

async function countTableRows(table: string): Promise<number | null> {
  const supabase = createServiceClient()
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true })
  if (error) {
    console.error(`[analytics] failed to count ${table}:`, error.message)
    return null
  }
  return count ?? null
}

function buildMetrics(
  events: EventRow[],
  registeredUsers: number | null,
  waitlistUsers: number | null,
  complaintStatus: { pending: number | null; completed: number | null },
  reportStatus: { pending: number | null; completed: number | null },
): Metrics {
  const sessions = sessionRows(events)
  const funnel = funnelRow(events)
  const uniqueSessions = sessions.length
  const totalEvents = events.length
  const repeatSessions = sessions.filter((row) => row.total_events > 1).length
  const sessionEvents = sessions.reduce((sum, row) => sum + row.total_events, 0)
  const avgEventsPerSession = uniqueSessions ? sessionEvents / uniqueSessions : 0
  const countryCounts = Object.fromEntries(countryRows(events).map((row) => [row.country, row.events]))

  return {
    totalEvents,
    uniqueSessions,
    repeatSessions,
    avgEventsPerSession,
    countryCounts,
    registeredUsers,
    waitlistUsers,
    complaintsPending: complaintStatus.pending,
    complaintsCompleted: complaintStatus.completed,
    reportsPending: reportStatus.pending,
    reportsCompleted: reportStatus.completed,
    avgStoryToSignupMinutes: funnel.avg_story_to_signup_minutes,
    avgSignupToDocsMinutes: funnel.avg_signup_to_docs_minutes,
    avgDocsToReportMinutes: funnel.avg_docs_to_report_minutes,
    avgReportToDownloadMinutes: funnel.avg_report_to_download_minutes,
  }
}

function formatNumber(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—"
  return new Intl.NumberFormat("en-SG").format(value)
}

export default async function AnalyticsPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) notFound()

  const userClient = await createUserClient()
  const { data: isAdmin, error: roleError } = await userClient.rpc("current_app_has_role", {
    p_role: "admin",
  })
  if (roleError || !isAdmin) notFound()

  // Model costs (cost-controls spec §6 C1): read only after the admin check above.
  let costs: CostDashboard | null = null
  try {
    costs = await loadCostDashboard(createServiceClient() as unknown as CostDashboardClient, usageEnvironment(process.env))
  } catch (error) {
    console.error("[analytics] model costs unavailable:", error instanceof Error ? error.message.slice(0, 120) : "unknown")
  }

  const [loadedEvents, registeredUsers, waitlistUsers, complaintStatus, reportStatus] = await Promise.all([
    fetchEvents(),
    countTableRows("profiles"),
    countTableRows("waitlist"),
    fetchStatusCounts("cases", ["completed"]),
    fetchStatusCounts("reports", REPORT_DONE),
  ])
  const events = loadedEvents ?? []
  const sessionCounts = dailySessionCounts(events)
  const sessionPeriods = GRANULARITIES.flatMap((granularity) => periodRows(events, granularity))

  const metrics = buildMetrics(events, registeredUsers, waitlistUsers, complaintStatus, reportStatus)

  return (
    <main className="min-h-screen bg-background">
      <SiteHeader />

      <div className="border-b border-border/50 bg-card/50">
        <div className="container mx-auto px-4 py-8 space-y-3">
          <Badge variant="outline" className="rounded-full">
            Analytics
          </Badge>
          <h1 className="text-4xl font-bold text-balance">Acquisition & engagement</h1>
          <p className="text-muted-foreground max-w-3xl">
            Live metrics read from the events, cases, reports, profiles and waitlist tables. Page views sent before 22 Nov
            2026 have no session, so they count as events but not as sessions.
          </p>
          {loadedEvents === null ? (
            <p role="status" className="text-sm text-destructive">Events are not available right now; event tiles show zero.</p>
          ) : null}
        </div>
      </div>

      <div className="container mx-auto px-4 py-10 space-y-8">
        <CostDashboardSection data={costs} capUsd={dailyCapUsd(process.env)} />

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Unique visits (sessions)</CardTitle>
              <CardDescription>Distinct sessions in the last year.</CardDescription>
            </CardHeader>
            <CardContent className="text-3xl font-bold">{formatNumber(metrics.uniqueSessions)}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Repeat visits</CardTitle>
              <CardDescription>Sessions with multiple events.</CardDescription>
            </CardHeader>
            <CardContent className="text-3xl font-bold">{formatNumber(metrics.repeatSessions)}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Avg. events per visit</CardTitle>
              <CardDescription>Proxy for pages/actions per session.</CardDescription>
            </CardHeader>
            <CardContent className="text-3xl font-bold">
              {metrics.avgEventsPerSession ? metrics.avgEventsPerSession.toFixed(1) : "—"}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Registered users</CardTitle>
              <CardDescription>Profiles count.</CardDescription>
            </CardHeader>
            <CardContent className="text-3xl font-bold">{formatNumber(metrics.registeredUsers)}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Waitlist</CardTitle>
              <CardDescription>Users waiting for unsupported case types.</CardDescription>
            </CardHeader>
            <CardContent className="text-3xl font-bold">{formatNumber(metrics.waitlistUsers)}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Complaints status</CardTitle>
              <CardDescription>Pending vs completed cases.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              <p className="text-lg font-semibold text-foreground">Pending: {formatNumber(metrics.complaintsPending)}</p>
              <p className="text-lg font-semibold text-foreground">Completed: {formatNumber(metrics.complaintsCompleted)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Reports status</CardTitle>
              <CardDescription>Pending vs completed, exported or resolved reports.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              <p className="text-lg font-semibold text-foreground">Pending: {formatNumber(metrics.reportsPending)}</p>
              <p className="text-lg font-semibold text-foreground">Completed: {formatNumber(metrics.reportsCompleted)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Total events</CardTitle>
              <CardDescription>All events in the last year, with or without a session.</CardDescription>
            </CardHeader>
            <CardContent className="text-3xl font-bold">{formatNumber(metrics.totalEvents)}</CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Funnel timing (minutes)</CardTitle>
            <CardDescription>Average time between key events, per session or account.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 text-sm text-muted-foreground">
            <div>
              <p className="text-xs uppercase tracking-wide">Story → Signup</p>
              <p className="text-2xl font-semibold text-foreground">
                {metrics.avgStoryToSignupMinutes !== null ? metrics.avgStoryToSignupMinutes.toFixed(1) : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide">Signup → Documents</p>
              <p className="text-2xl font-semibold text-foreground">
                {metrics.avgSignupToDocsMinutes !== null ? metrics.avgSignupToDocsMinutes.toFixed(1) : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide">Documents → Report</p>
              <p className="text-2xl font-semibold text-foreground">
                {metrics.avgDocsToReportMinutes !== null ? metrics.avgDocsToReportMinutes.toFixed(1) : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide">Report → Download</p>
              <p className="text-2xl font-semibold text-foreground">
                {metrics.avgReportToDownloadMinutes !== null ? metrics.avgReportToDownloadMinutes.toFixed(1) : "—"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Countries (from event data)</CardTitle>
            <CardDescription>Events by the country recorded with them.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            {Object.keys(metrics.countryCounts).length === 0 ? (
              <p>No country data found.</p>
            ) : (
              <ul className="space-y-1">
                {Object.entries(metrics.countryCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([country, count]) => (
                    <li key={country} className="flex items-center justify-between">
                      <span>{country}</span>
                      <span className="font-medium text-foreground">{formatNumber(count)}</span>
                    </li>
                  ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sessions per day</CardTitle>
            <CardDescription>Distinct sessions and events per day (latest 14 days).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            {sessionCounts.length === 0 ? (
              <p>No session data available.</p>
            ) : (
              <ul className="space-y-1">
                {sessionCounts.slice(0, 14).map((row) => (
                  <li key={row.day ?? Math.random()} className="flex items-center justify-between">
                    <span className="font-medium text-foreground">
                      {row.day ? new Date(row.day).toLocaleDateString() : "Unknown day"}
                    </span>
                    <span className="flex items-center gap-3">
                      <span>Sessions: {formatNumber(row.unique_sessions)}</span>
                      <span>Events: {formatNumber(row.total_events)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sessions by period</CardTitle>
            <CardDescription>Daily, weekly, monthly, quarterly, yearly rollups with cumulative totals.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            {["day", "week", "month", "quarter", "year"].map((granularity) => {
              const rows = sessionPeriods.filter((r) => r.granularity === granularity).slice(0, granularity === "day" ? 30 : 8)
              return (
                <div key={granularity} className="space-y-2">
                  <p className="font-semibold text-foreground uppercase text-xs">{granularity}</p>
                  {rows.length === 0 ? (
                    <p>No data</p>
                  ) : (
                    <ul className="space-y-1">
                      {rows.map((row) => (
                        <li key={`${granularity}-${row.period_start ?? Math.random()}`} className="flex items-center justify-between">
                          <span>{row.period_start ? new Date(row.period_start).toLocaleDateString() : "Unknown"}</span>
                          <span className="flex flex-wrap items-center gap-3 justify-end">
                            <span>Sessions: {formatNumber(row.unique_sessions)}</span>
                            <span>Events: {formatNumber(row.total_events)}</span>
                            <span className="text-xs text-muted-foreground">
                              Cumul: {formatNumber(row.cumulative_sessions)} sessions / {formatNumber(row.cumulative_events)} events
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Instrumentation gaps & next steps</CardTitle>
            <CardDescription>What to add to make metrics actionable.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <ul className="list-disc list-inside space-y-1">
              <li>Add page_view on any route with a custom layout (root layout already covered).</li>
              <li>Ensure IP-to-country enrichment (your edge should set a trusted geo header such as CF-IPCountry).</li>
              <li>Keep emitting funnel events: story_submitted, signup_complete, documents_uploaded, report_generated, report_downloaded.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
