import type { Metadata } from "next"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { createServiceClient } from "@/lib/supabase/service"

export const metadata: Metadata = {
  title: "Analytics | GuideBuoy AI",
  description: "Live metrics for visits, engagement, registrations, and waitlist interest.",
}

export const dynamic = "force-dynamic"

type AnalyticsEvent = {
  session_id: string | null
  user_id: string | null
  page_url: string | null
  event_name: string | null
  created_at: string | null
  event_data: Record<string, unknown> | null
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

async function fetchEvents(): Promise<AnalyticsEvent[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from("analytics_events")
    .select("session_id,user_id,page_url,event_name,created_at,event_data")
    .order("created_at", { ascending: false })
    .limit(5000)

  if (error) {
    console.error("[analytics] failed to load events:", error.message)
    return []
  }

  return data ?? []
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

function buildDurations(events: AnalyticsEvent[]) {
  const bySession = new Map<string, { [key: string]: number }>()

  for (const evt of events) {
    const key = evt.session_id || evt.user_id
    if (!key || !evt.created_at) continue
    const time = new Date(evt.created_at).getTime()
    const map = bySession.get(key) ?? {}
    if (evt.event_name) {
      map[evt.event_name] = Math.min(map[evt.event_name] ?? Number.POSITIVE_INFINITY, time)
    }
    bySession.set(key, map)
  }

  const storyToSignup: number[] = []
  const signupToDocs: number[] = []
  const docsToReport: number[] = []
  const reportToDownload: number[] = []

  for (const map of bySession.values()) {
    if (map.story_submitted && map.signup_complete) {
      storyToSignup.push(map.signup_complete - map.story_submitted)
    }
    if (map.signup_complete && map.documents_uploaded) {
      signupToDocs.push(map.documents_uploaded - map.signup_complete)
    }
    if (map.documents_uploaded && map.report_generated) {
      docsToReport.push(map.report_generated - map.documents_uploaded)
    }
    if (map.report_generated && map.report_downloaded) {
      reportToDownload.push(map.report_downloaded - map.report_generated)
    }
  }

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null)

  return {
    avgStoryToSignupMinutes: avg(storyToSignup) !== null ? (avg(storyToSignup)! / 60000) : null,
    avgSignupToDocsMinutes: avg(signupToDocs) !== null ? (avg(signupToDocs)! / 60000) : null,
    avgDocsToReportMinutes: avg(docsToReport) !== null ? (avg(docsToReport)! / 60000) : null,
    avgReportToDownloadMinutes: avg(reportToDownload) !== null ? (avg(reportToDownload)! / 60000) : null,
  }
}

function buildMetrics(events: AnalyticsEvent[], registeredUsers: number | null, waitlistUsers: number | null): Metrics {
  const sessionCounts = new Map<string, number>()
  const countryCounts: Record<string, number> = {}

  for (const evt of events) {
    const sessionId = evt.session_id ?? "unknown"
    sessionCounts.set(sessionId, (sessionCounts.get(sessionId) ?? 0) + 1)

    const country =
      (evt.event_data?.country as string | undefined) ||
      (evt.event_data?.country_code as string | undefined) ||
      (evt.event_data?.ip_country as string | undefined)

    if (country) {
      countryCounts[country] = (countryCounts[country] ?? 0) + 1
    }
  }

  const uniqueSessions = sessionCounts.size
  const repeatSessions = Array.from(sessionCounts.values()).filter((count) => count > 1).length
  const totalEvents = events.length
  const avgEventsPerSession = uniqueSessions ? totalEvents / uniqueSessions : 0

  const durations = buildDurations(events)

  return {
    totalEvents,
    uniqueSessions,
    repeatSessions,
    avgEventsPerSession,
    countryCounts,
    registeredUsers,
    waitlistUsers,
    ...durations,
  }
}

function formatNumber(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—"
  return new Intl.NumberFormat("en-SG").format(value)
}

export default async function AnalyticsPage() {
  const [events, registeredUsers, waitlistUsers] = await Promise.all([
    fetchEvents(),
    countTableRows("profiles"),
    countTableRows("waitlist"),
  ])

  const metrics = buildMetrics(events, registeredUsers, waitlistUsers)

  return (
    <main className="min-h-screen bg-background">
      <div className="border-b border-border/50 bg-card/50">
        <div className="container mx-auto px-4 py-8 space-y-3">
          <Badge variant="outline" className="rounded-full">
            Analytics
          </Badge>
          <h1 className="text-4xl font-bold text-balance">Acquisition & engagement</h1>
          <p className="text-muted-foreground max-w-3xl">
            Live metrics pulled from Supabase analytics events, profiles, and waitlist tables. Data is capped at the most
            recent 5,000 events; add rollups in the database if you need full-history accuracy.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10 space-y-8">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Unique visits (sessions)</CardTitle>
              <CardDescription>Distinct sessions seen in the latest slice of events.</CardDescription>
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
              <CardTitle>Total events (sampled)</CardTitle>
              <CardDescription>Events in the latest 5,000 rows.</CardDescription>
            </CardHeader>
            <CardContent className="text-3xl font-bold">{formatNumber(metrics.totalEvents)}</CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Funnel timing (minutes, latest sample)</CardTitle>
            <CardDescription>Average time between key events. Add more events to improve accuracy.</CardDescription>
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
              Based on any country fields present in event_data (country, country_code, ip_country). Add IP-to-country
              enrichment to improve accuracy.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            {Object.keys(metrics.countryCounts).length === 0 ? (
              <p>No country data found in recent events.</p>
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
            <CardTitle>Instrumentation gaps & next steps</CardTitle>
            <CardDescription>What to add to make metrics actionable.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <ul className="list-disc list-inside space-y-1">
              <li>
                Add a global page/view event (with session_id) on route change so pages-per-visit is accurate. Today only
                select screens fire events.
              </li>
              <li>
                Capture IP-to-country once per session (store country on the first event) to improve geo analytics. For
                higher accuracy, add an edge middleware that enriches requests with a trusted geo header.
              </li>
              <li>
                Emit funnel timestamps: story_submitted, signup_completed, documents_uploaded, report_generated so we can
                compute time-to-signup, time-to-docs, and time-to-report.
              </li>
              <li>
                Track distinct users vs sessions by attaching user_id (already supported) on all events after auth.
              </li>
              <li>
                Create Supabase views/materialized views for aggregates to avoid sampling and large event scans.
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
