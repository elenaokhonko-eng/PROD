// Admin cost page data (cost-controls spec §6 C1). Reads public.model_usage and the free-evaluation review rows in
// analytics_events through the service client, after the page's admin check. Numbers, models, purposes and case IDs
// only: model_usage holds no text, and only these columns are selected.

import { singaporeDayStart } from "./cost-alerts"

export interface UsageRow {
  created_at: string
  purpose: string
  model: string
  outcome: string
  http_status: number | null
  estimated_cost_usd: number | string
  case_id: string | null
}

export interface EvaluationEvent {
  event_name: string
  created_at: string
}

export interface SpendLine {
  key: string
  calls: number
  usd: number
}

export interface CostWindow {
  calls: number
  usd: number
  byPurpose: SpendLine[]
  byModel: SpendLine[]
  rateLimited: number
  evaluations: number
  summaryVersions: number
  /** Share of free evaluations delivered as the summary version (fallback). */
  fallbackRate: number | null
  costPerEvaluation: number | null
}

export interface CostDashboard {
  environment: string
  today: CostWindow
  week: CostWindow
  topCases: Array<{ caseId: string; usd: number; calls: number }>
}

export const USAGE_COLUMNS = "created_at, purpose, model, outcome, http_status, estimated_cost_usd, case_id"
export const EVALUATION_EVENTS = ["free_evaluation_summary", "free_evaluation_summary_version"] as const

const round = (n: number) => Math.round(n * 1e6) / 1e6

function lines(rows: UsageRow[], key: (r: UsageRow) => string): SpendLine[] {
  const m = new Map<string, SpendLine>()
  for (const r of rows) {
    const k = key(r)
    const line = m.get(k) ?? { key: k, calls: 0, usd: 0 }
    line.calls += 1
    line.usd += Number(r.estimated_cost_usd) || 0
    m.set(k, line)
  }
  return [...m.values()].map((l) => ({ ...l, usd: round(l.usd) })).sort((a, b) => b.usd - a.usd || b.calls - a.calls)
}

function window(rows: UsageRow[], events: EvaluationEvent[]): CostWindow {
  const usd = round(rows.reduce((s, r) => s + (Number(r.estimated_cost_usd) || 0), 0))
  const evaluations = events.length
  const summaryVersions = events.filter((e) => e.event_name === "free_evaluation_summary_version").length
  return {
    calls: rows.length,
    usd,
    byPurpose: lines(rows, (r) => r.purpose),
    byModel: lines(rows, (r) => r.model),
    rateLimited: rows.filter((r) => r.http_status === 429).length,
    evaluations,
    summaryVersions,
    fallbackRate: evaluations ? summaryVersions / evaluations : null,
    costPerEvaluation: evaluations ? round(usd / evaluations) : null,
  }
}

/** Pure: today (Singapore day) and the last 7 days, from rows already limited to the last 7 days. */
export function summariseCosts(environment: string, rows: UsageRow[], events: EvaluationEvent[], now: Date): CostDashboard {
  const todayStart = singaporeDayStart(now)
  const isToday = (iso: string) => new Date(iso).getTime() >= new Date(todayStart).getTime()
  const byCase = new Map<string, { usd: number; calls: number }>()
  for (const r of rows) {
    if (!r.case_id) continue
    const c = byCase.get(r.case_id) ?? { usd: 0, calls: 0 }
    c.usd += Number(r.estimated_cost_usd) || 0
    c.calls += 1
    byCase.set(r.case_id, c)
  }
  return {
    environment,
    today: window(rows.filter((r) => isToday(r.created_at)), events.filter((e) => isToday(e.created_at))),
    week: window(rows, events),
    topCases: [...byCase]
      .map(([caseId, c]) => ({ caseId, usd: round(c.usd), calls: c.calls }))
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 10),
  }
}

// The minimal supabase-js surface used here.
interface Query extends PromiseLike<{ data: unknown; error: { code?: string } | null }> {
  eq(column: string, value: unknown): Query
  gte(column: string, value: unknown): Query
  in(column: string, values: readonly unknown[]): Query
  limit(n: number): Query
}
export interface CostDashboardClient {
  from(table: string): { select(columns: string): Query }
}

export async function loadCostDashboard(client: CostDashboardClient, environment: string, now: Date = new Date()): Promise<CostDashboard> {
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString()
  const [usage, events] = await Promise.all([
    client.from("model_usage").select(USAGE_COLUMNS).eq("environment", environment).gte("created_at", since).limit(50_000),
    client.from("analytics_events").select("event_name, created_at").in("event_name", EVALUATION_EVENTS).gte("created_at", since).limit(50_000),
  ])
  if (usage.error) throw new Error(`model_usage read failed: ${usage.error.code ?? "unknown"}`)
  if (events.error) throw new Error(`analytics_events read failed: ${events.error.code ?? "unknown"}`)
  return summariseCosts(environment, (usage.data ?? []) as UsageRow[], (events.data ?? []) as EvaluationEvent[], now)
}
