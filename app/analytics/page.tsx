import type { Metadata } from "next"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { createServiceClient } from "@/lib/supabase/service"

export const metadata: Metadata = {
  title: "Analytics | GuideBuoy AI",
  description: "Live metrics from Supabase views: sessions, engagement, funnels, registrations, and waitlist.",
}

export const dynamic = "force-dynamic"

type PageSessionRow = {
  session_id: string | null
  page_views: number | null
  total_events: number | null
}

type CountryRow = {
  country: string | null
  events: number | null
}

type SessionCountRow = {
  day: string | null
  unique_sessions: number | null
  total_events: number | null
}

type SessionPeriodRow = {
  granularity: string | null
  period_start: string | null
  unique_sessions: number | null
  total_events: number | null
  cumulative_sessions: number | null
  cumulative_events: number | null
}

type FunnelRow = {
  avg_story_to_signup_minutes: number | null
  avg_signup_to_docs_minutes: number | null
  avg_docs_to_report_minutes: number | null
  avg_report_to_download_minutes: number | null
}

type Metrics = {
  totalEvents: number
  uniqueSessions: number
  repeatSessions: number
  avgEventsPerSession: number
  countryCounts: Record<string, number>
  registeredUsers: number | null
  waitlistUsers: number | null
  avgStoryToSignupMinutes: number | null
  avgSignupToDocsMinutes: number | null
  avgDocsToReportMinutes: number | null
  avgReportToDownloadMinutes: number | null
}

async function fetchSessionRows(): Promise<PageSessionRow[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase.from("mv_pages_per_session").select("session_id,page_views,total_events")
  if (error) {
    console.error("[analytics] failed to load mv_pages_per_session:", error.message)
    return []
  }
  return data ?? []
}

async function fetchCountryRows(): Promise<CountryRow[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase.from("mv_country_rollup").select("country,events").order("events", { ascending: false })
  if (error) {
    console.error("[analytics] failed to load mv_country_rollup:", error.message)
    return []
  }
  return data ?? []
}

async function fetchSessionCounts(): Promise<SessionCountRow[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from("mv_session_counts")
    .select("day,unique_sessions,total_events")
    .order("day", { ascending: false })

  if (error) {
    console.error("[analytics] failed to load mv_session_counts:", error.message)
    return []
  }
  return data ?? []
}

async function fetchSessionPeriods(): Promise<SessionPeriodRow[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from("mv_session_counts_periods")
    .select("granularity,period_start,unique_sessions,total_events,cumulative_sessions,cumulative_events")
    .order("period_start", { ascending: false })

  if (error) {
    console.error("[analytics] failed to load mv_session_counts_periods:", error.message)
    return []
  }
  return data ?? []
}

async function fetchFunnelRow(): Promise<FunnelRow | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase.from("mv_funnel_durations").select("*").maybeSingle()
  if (error) {
    console.error("[analytics] failed to load mv_funnel_durations:", error.message)
    return null
  }
  return data ?? null
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
  sessions: PageSessionRow[],
  countries: CountryRow[],
  funnel: FunnelRow | null,
  registeredUsers: number | null,
  waitlistUsers: number | null,
): Metrics {
  const uniqueSessions = sessions.length
  const totalEvents = sessions.reduce((sum, row) => sum + (row.total_events ?? 0), 0)
  const repeatSessions = sessions.filter((row) => (row.total_events ?? 0) > 1).length
  const avgEventsPerSession = uniqueSessions ? totalEvents / uniqueSessions : 0

  const countryCounts: Record<string, number> = {}
  for (const row of countries) {
    const key = row.country ?? "UNKNOWN"
    countryCounts[key] = row.events ?? 0
  }

  return {
    totalEvents,
    uniqueSessions,
    repeatSessions,
    avgEventsPerSession,
    countryCounts,
    registeredUsers,
    waitlistUsers,
    avgStoryToSignupMinutes: funnel?.avg_story_to_signup_minutes ?? null,
    avgSignupToDocsMinutes: funnel?.avg_signup_to_docs_minutes ?? null,
    avgDocsToReportMinutes: funnel?.avg_docs_to_report_minutes ?? null,
    avgReportToDownloadMinutes: funnel?.avg_report_to_download_minutes ?? null,
  }
}

function formatNumber(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—"
  return new Intl.NumberFormat("en-SG").format(value)
}

export default async function AnalyticsPage() {
  const [sessions, countries, sessionCounts, sessionPeriods, funnel, registeredUsers, waitlistUsers] = await Promise.all([
    fetchSessionRows(),
    fetchCountryRows(),
    fetchSessionCounts(),
    fetchSessionPeriods(),
    fetchFunnelRow(),
    countTableRows("profiles"),
    countTableRows("waitlist"),
  ])

  const metrics = buildMetrics(sessions, countries, funnel, registeredUsers, waitlistUsers)

  return (
    <main className="min-h-screen bg-background">
      <div className="border-b border-border/50 bg-card/50">
        <div className="container mx-auto px-4 py-8 space-y-3">
          <Badge variant="outline" className="rounded-full">
            Analytics
          </Badge>
          <h1 className="text-4xl font-bold text-balance">Acquisition & engagement</h1>
          <p className="text-muted-foreground max-w-3xl">
            Live metrics pulled from Supabase materialized views, plus profiles and waitlist tables.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10 space-y-8">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Unique visits (sessions)</CardTitle>
              <CardDescription>Distinct sessions from mv_pages_per_session.</CardDescription>
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
              <CardTitle>Total events</CardTitle>
              <CardDescription>Events summed from mv_pages_per_session.</CardDescription>
            </CardHeader>
            <CardContent className="text-3xl font-bold">{formatNumber(metrics.totalEvents)}</CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Funnel timing (minutes)</CardTitle>
            <CardDescription>Average time between key events from mv_funnel_durations.</CardDescription>
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
            <CardDescription>
              Based on ip_country/country fields in mv_country_rollup. Improve accuracy by adding a trusted geo header at
              the edge (e.g., CF-IPCountry).
            </CardDescription>
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
            <CardDescription>Distinct sessions and events from mv_session_counts (latest 14 days).</CardDescription>
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
              <li>
                Ensure IP-to-country enrichment (Cloudflare CF-IPCountry or your own IP lookup) and forward it as a trusted
                header.
              </li>
              <li>Keep emitting funnel events: story_submitted, signup_complete, documents_uploaded, report_generated, report_downloaded.</li>
              <li>Create a scheduled REFRESH for all MVs to keep dashboards current.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
