// Cost alerts (cost-controls spec §6 C2, approved by Elena 8 Nov 2026). Run hourly by the worker. Each alert kind is
// emailed at most once per Singapore day; a sent alert is recorded as an analytics_events row (event_name
// 'cost_alert', event_data {kind, day}). Emails carry numbers, case IDs and the environment only, never case content.
// Model health has its own check (ai_model_health_v1); a key used from an unexpected IP is a Google Cloud console
// alert (docs/runbooks/model-keys-and-costs.md).

import { DAILY_WARN_RATIO, dailyCapUsd, usageEnvironment } from "../../supabase/functions/_shared/model-usage"

export const SINGLE_CASE_ALERT_USD = 2
export const RATE_LIMIT_ALERT_RATIO = 0.05
export const RATE_LIMIT_ALERT_MIN_CALLS = 20

export type CostAlertKind = "daily_spend" | "single_case" | "rate_limited"

export interface CostAlertStore {
  spendToday(environment: string): Promise<number>
  /** Spend per case today (Singapore day), case IDs only. */
  caseSpendToday(environment: string): Promise<Array<{ caseId: string; usd: number }>>
  /** Model calls in the last hour, and how many the provider answered with HTTP 429. */
  lastHourCalls(environment: string): Promise<{ calls: number; rateLimited: number }>
  alreadySent(kind: CostAlertKind, day: string, environment: string): Promise<boolean>
  markSent(kind: CostAlertKind, day: string, environment: string): Promise<void>
}

export interface CostAlert {
  kind: CostAlertKind
  subject: string
  text: string
}

/** The Singapore calendar day, YYYY-MM-DD. */
export function singaporeDay(now: Date): string {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10)
}

/** Start of the Singapore day containing `now`, as an ISO instant. */
export function singaporeDayStart(now: Date): string {
  return new Date(`${singaporeDay(now)}T00:00:00+08:00`).toISOString()
}

const usd = (n: number) => `US$${n.toFixed(2)}`

/** Which alerts are due now, before dedupe. Pure, for tests. */
export async function dueCostAlerts(store: CostAlertStore, env: Record<string, string | undefined>): Promise<CostAlert[]> {
  const environment = usageEnvironment(env)
  const cap = dailyCapUsd(env)
  const alerts: CostAlert[] = []

  const spent = await store.spendToday(environment)
  if (spent >= cap * DAILY_WARN_RATIO) {
    alerts.push({
      kind: "daily_spend",
      subject: `GuideBuoy ${environment}: model spend ${usd(spent)} of the ${usd(cap)} daily cap`,
      text: `Estimated model spend today (Singapore time) is ${usd(spent)}, ${Math.round((spent / cap) * 100)}% of the ${usd(cap)} daily cap.\nAt 100% model calls stop and people get the summary version.\nSee /analytics for spend by purpose and model.`,
    })
  }

  const heavy = (await store.caseSpendToday(environment)).filter((c) => c.usd > SINGLE_CASE_ALERT_USD).sort((a, b) => b.usd - a.usd)
  if (heavy.length) {
    alerts.push({
      kind: "single_case",
      subject: `GuideBuoy ${environment}: ${heavy.length} case(s) over ${usd(SINGLE_CASE_ALERT_USD)} in model spend today`,
      text: `Cases over ${usd(SINGLE_CASE_ALERT_USD)} today:\n${heavy.slice(0, 10).map((c) => `- ${c.caseId}: ${usd(c.usd)}`).join("\n")}\nSee /analytics, "Top cases by spend".`,
    })
  }

  const { calls, rateLimited } = await store.lastHourCalls(environment)
  if (calls >= RATE_LIMIT_ALERT_MIN_CALLS && rateLimited / calls > RATE_LIMIT_ALERT_RATIO) {
    alerts.push({
      kind: "rate_limited",
      subject: `GuideBuoy ${environment}: ${Math.round((rateLimited / calls) * 100)}% of model calls rate-limited in the last hour`,
      text: `${rateLimited} of ${calls} model calls in the last hour were refused with HTTP 429 (alert above ${RATE_LIMIT_ALERT_RATIO * 100}%).\nCheck the provider quotas and /analytics.`,
    })
  }
  return alerts
}

/** Sends each due alert once per Singapore day per kind. Returns the kinds sent. */
export async function evaluateCostAlerts(
  store: CostAlertStore,
  env: Record<string, string | undefined>,
  send: (alert: CostAlert, to: string) => Promise<void>,
  now: Date = new Date(),
): Promise<CostAlertKind[]> {
  const to = (env.COST_ALERT_EMAIL ?? env.ADMIN_EMAIL ?? "").trim()
  if (!to) return []
  const environment = usageEnvironment(env)
  const day = singaporeDay(now)
  const sent: CostAlertKind[] = []
  for (const alert of await dueCostAlerts(store, env)) {
    if (await store.alreadySent(alert.kind, day, environment)) continue
    await send(alert, to)
    await store.markSent(alert.kind, day, environment)
    sent.push(alert.kind)
  }
  return sent
}

// The minimal supabase-js surface used here, so the worker can pass its own service client.
interface Query extends PromiseLike<{ data: unknown; error: { code?: string } | null }> {
  eq(column: string, value: unknown): Query
  gte(column: string, value: unknown): Query
  not(column: string, operator: string, value: unknown): Query
  limit(n: number): Query
}
export interface CostAlertClient {
  from(table: string): {
    select(columns: string): Query
    insert(row: Record<string, unknown>): PromiseLike<{ error: { code?: string } | null }>
  }
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string } | null }>
}

export function supabaseCostAlertStore(client: CostAlertClient, now: () => Date = () => new Date()): CostAlertStore {
  const rows = async <T>(q: Query): Promise<T[]> => {
    const { data, error } = await q
    if (error) throw new Error(`cost alert query failed: ${error.code ?? "unknown"}`)
    return (data ?? []) as T[]
  }
  return {
    async spendToday(environment) {
      const { data, error } = await client.rpc("model_usage_spend_today", { p_environment: environment })
      if (error) throw new Error(`cost alert spend failed: ${error.code ?? "unknown"}`)
      return Number(data) || 0
    },
    async caseSpendToday(environment) {
      const data = await rows<{ case_id: string; estimated_cost_usd: number | string }>(
        client.from("model_usage").select("case_id, estimated_cost_usd").eq("environment", environment)
          .gte("created_at", singaporeDayStart(now())).not("case_id", "is", null).limit(10_000),
      )
      const byCase = new Map<string, number>()
      for (const r of data) byCase.set(r.case_id, (byCase.get(r.case_id) ?? 0) + Number(r.estimated_cost_usd))
      return [...byCase].map(([caseId, total]) => ({ caseId, usd: Math.round(total * 1e6) / 1e6 }))
    },
    async lastHourCalls(environment) {
      const data = await rows<{ http_status: number | null }>(
        client.from("model_usage").select("http_status").eq("environment", environment)
          .gte("created_at", new Date(now().getTime() - 3_600_000).toISOString()).limit(10_000),
      )
      return { calls: data.length, rateLimited: data.filter((r) => r.http_status === 429).length }
    },
    async alreadySent(kind, day, environment) {
      const data = await rows<{ id: string }>(
        client.from("analytics_events").select("id").eq("event_name", "cost_alert")
          .eq("event_data->>kind", kind).eq("event_data->>day", day).eq("event_data->>environment", environment).limit(1),
      )
      return data.length > 0
    },
    async markSent(kind, day, environment) {
      const { error } = await client.from("analytics_events").insert({ event_name: "cost_alert", event_data: { kind, day, environment } })
      if (error) throw new Error(`cost alert record failed: ${error.code ?? "unknown"}`)
    },
  }
}
