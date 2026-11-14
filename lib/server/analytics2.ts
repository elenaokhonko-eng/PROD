import type { FunnelEvent } from '@/lib/analytics/funnel'

// Analytics 2 (brief W1 §N; Elena, 14 Nov 2026): the top-down view of the journey. Browser steps come from funnel_events
// (one random number per tab); later steps from the timestamps already kept with accounts, cases, evaluations, the
// waitlist and purchases. Everything here is a count, a share or a time across many people; no row is shown.

export type FunnelRow = {
  event: FunnelEvent
  anon_session_id: string
  created_at: string
  device_class: string | null
  utm_source: string | null
  referrer_host: string | null
}
export type Channel = { referrer_host?: string; utm_source?: string; device_class?: string }
export type JourneyInputs = {
  funnel: FunnelRow[]
  accounts: { created_at: string }[]
  cases: { id: string; created_at: string; first_touch: Channel | null }[]
  evaluations: { case_id: string; created_at: string }[]
  interest: { created_at: string; source: string | null }[]
  purchases: { case_id: string; product_code: string; paid_at: string | null; payment_status: string }[]
}

export type Step = { key: string; label: string; source: 'browser' | 'records'; count: number; fromPrevious: number | null }
export type Timing = { label: string; count: number; medianMinutes: number | null; slowQuarterMinutes: number | null }
export type SplitRow = { value: string; counts: Record<string, number> }
export type Split = { dimension: string; rows: SplitRow[] }
export type DayRow = { day: string; counts: Record<string, number> }
export type Analytics2View = {
  days: number
  steps: Step[]
  dropOff: { label: string; count: number; of: number }[]
  splits: Split[]
  evaluationsByChannel: Split[]
  timings: Timing[]
  daily: DayRow[]
  browserStepKeys: string[]
}

export const BROWSER_STEPS: { key: FunnelEvent; label: string }[] = [
  { key: 'home_viewed', label: 'Home viewed' },
  { key: 'story_started', label: 'Story started' },
  { key: 'story_submitted', label: 'Story submitted' },
  { key: 'signup_reached', label: 'Reached sign-up' },
  { key: 'case_created', label: 'Case created (browser)' },
]

const BANK_PACK = 'self_serve_report'
const FIDREC_PACK = 'escalation_pack'
const MINUTE = 60_000

const share = (count: number, of: number) => (of > 0 ? Math.round((count / of) * 1000) / 10 : null)

/** The value at a fraction through the sorted list (0.5 = median), by nearest rank. */
export function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))]
}

function timing(label: string, minutes: number[]): Timing {
  const round = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10)
  return { label, count: minutes.length, medianMinutes: round(percentile(minutes, 0.5)), slowQuarterMinutes: round(percentile(minutes, 0.75)) }
}

/** Each tab's first time at each step. */
function firstTimes(funnel: FunnelRow[]): Map<string, Map<FunnelEvent, number>> {
  const tabs = new Map<string, Map<FunnelEvent, number>>()
  for (const row of funnel) {
    const at = Date.parse(row.created_at)
    const steps = tabs.get(row.anon_session_id) ?? new Map<FunnelEvent, number>()
    const seen = steps.get(row.event)
    if (seen === undefined || at < seen) steps.set(row.event, at)
    tabs.set(row.anon_session_id, steps)
  }
  return tabs
}

function gaps(tabs: Map<string, Map<FunnelEvent, number>>, from: FunnelEvent, to: FunnelEvent): number[] {
  const minutes: number[] = []
  for (const steps of tabs.values()) {
    const start = steps.get(from)
    const end = steps.get(to)
    if (start !== undefined && end !== undefined && end >= start) minutes.push((end - start) / MINUTE)
  }
  return minutes
}

function splitBy(funnel: FunnelRow[], dimension: string, pick: (row: FunnelRow) => string): Split {
  const byValue = new Map<string, Map<string, Set<string>>>()
  for (const row of funnel) {
    const value = pick(row)
    const steps = byValue.get(value) ?? new Map<string, Set<string>>()
    const tabs = steps.get(row.event) ?? new Set<string>()
    tabs.add(row.anon_session_id)
    steps.set(row.event, tabs)
    byValue.set(value, steps)
  }
  const rows = [...byValue.entries()].map(([value, steps]) => ({
    value,
    counts: Object.fromEntries(BROWSER_STEPS.map(({ key }) => [key, steps.get(key)?.size ?? 0])),
  }))
  rows.sort((a, b) => (b.counts.home_viewed ?? 0) - (a.counts.home_viewed ?? 0) || a.value.localeCompare(b.value))
  return { dimension, rows }
}

function evaluationSplit(inputs: JourneyInputs, dimension: string, pick: (channel: Channel | null) => string): Split {
  const evaluated = new Set(inputs.evaluations.map((evaluation) => evaluation.case_id))
  const byValue = new Map<string, { cases: number; evaluations: number }>()
  for (const item of inputs.cases) {
    const value = pick(item.first_touch)
    const entry = byValue.get(value) ?? { cases: 0, evaluations: 0 }
    entry.cases += 1
    if (evaluated.has(item.id)) entry.evaluations += 1
    byValue.set(value, entry)
  }
  const rows = [...byValue.entries()]
    .map(([value, counts]) => ({ value, counts }))
    .sort((a, b) => b.counts.evaluations - a.counts.evaluations || a.value.localeCompare(b.value))
  return { dimension, rows }
}

const dayOf = (iso: string) => iso.slice(0, 10)
const sourceOf = (value: string | null | undefined) => value || '(none)'
const referrerOf = (value: string | null | undefined) => value || '(direct or unknown)'
const deviceOf = (value: string | null | undefined) => value || '(unknown)'

export function summariseJourney(inputs: JourneyInputs, days: number): Analytics2View {
  const tabs = firstTimes(inputs.funnel)
  const tabsAt = (event: FunnelEvent) => [...tabs.values()].filter((steps) => steps.has(event)).length

  const paid = (product: string) => inputs.purchases.filter((purchase) => purchase.product_code === product && purchase.paid_at)
  const interestIn = (product: string) => inputs.interest.filter((row) => (row.source ?? '').split(',').includes(`stage2:${product}`)).length

  const browser = BROWSER_STEPS.map(({ key, label }) => ({ key, label, source: 'browser' as const, count: tabsAt(key) }))
  const records = [
    { key: 'account_created', label: 'Accounts created', count: inputs.accounts.length },
    { key: 'case_created_record', label: 'Cases created', count: inputs.cases.length },
    { key: 'evaluation_delivered', label: 'Evaluations delivered', count: new Set(inputs.evaluations.map((e) => e.case_id)).size },
    { key: 'bank_interest', label: 'Interest: Bank dispute pack', count: interestIn('bank_pack') },
    { key: 'fidrec_interest', label: 'Interest: FIDReC escalation pack', count: interestIn('fidrec_pack') },
    { key: 'bank_paid', label: 'Bought: Bank dispute pack', count: paid(BANK_PACK).length },
    { key: 'fidrec_paid', label: 'Bought: FIDReC escalation pack', count: paid(FIDREC_PACK).length },
  ].map((step) => ({ ...step, source: 'records' as const }))

  // Share from the step before, within the same source; the interest and purchase lines are shares of evaluations.
  const steps: Step[] = [
    ...browser.map((step, index) => ({ ...step, fromPrevious: index === 0 ? null : share(step.count, browser[index - 1].count) })),
    ...records.map((step, index) => {
      if (index === 0) return { ...step, fromPrevious: null }
      const base = index <= 2 ? records[index - 1].count : records[2].count
      return { ...step, fromPrevious: share(step.count, base) }
    }),
  ]

  const submittedTabs = [...tabs.values()].filter((s) => s.has('story_submitted'))
  const reachedTabs = [...tabs.values()].filter((s) => s.has('signup_reached'))
  const dropOff = [
    { label: 'Submitted a story but never reached sign-up', count: submittedTabs.filter((s) => !s.has('signup_reached')).length, of: submittedTabs.length },
    { label: 'Reached sign-up but no case was created', count: reachedTabs.filter((s) => !s.has('case_created')).length, of: reachedTabs.length },
  ]

  const evaluationAt = new Map<string, number>()
  for (const evaluation of inputs.evaluations) {
    const at = Date.parse(evaluation.created_at)
    const seen = evaluationAt.get(evaluation.case_id)
    if (seen === undefined || at < seen) evaluationAt.set(evaluation.case_id, at)
  }
  const caseToEvaluation = inputs.cases.flatMap((item) => {
    const at = evaluationAt.get(item.id)
    return at === undefined ? [] : [(at - Date.parse(item.created_at)) / MINUTE]
  })
  const evaluationToPurchase = (product: string) =>
    paid(product).flatMap((purchase) => {
      const at = evaluationAt.get(purchase.case_id)
      return at === undefined ? [] : [(Date.parse(purchase.paid_at!) - at) / MINUTE]
    })

  const timings = [
    timing('Home viewed → story submitted', gaps(tabs, 'home_viewed', 'story_submitted')),
    timing('Story submitted → case created (includes sign-up)', gaps(tabs, 'story_submitted', 'case_created')),
    timing('Case created → free evaluation delivered', caseToEvaluation.filter((m) => m >= 0)),
    timing('Free evaluation → Bank dispute pack bought', evaluationToPurchase(BANK_PACK).filter((m) => m >= 0)),
    timing('Free evaluation → FIDReC escalation pack bought', evaluationToPurchase(FIDREC_PACK).filter((m) => m >= 0)),
  ]

  const daily = new Map<string, Record<string, number>>()
  const bump = (iso: string, key: string) => {
    const day = daily.get(dayOf(iso)) ?? {}
    day[key] = (day[key] ?? 0) + 1
    daily.set(dayOf(iso), day)
  }
  for (const steps of tabs.values()) for (const [event, at] of steps) bump(new Date(at).toISOString(), event)
  for (const row of inputs.accounts) bump(row.created_at, 'account_created')
  for (const row of inputs.cases) bump(row.created_at, 'case_created_record')
  for (const [, at] of evaluationAt) bump(new Date(at).toISOString(), 'evaluation_delivered')

  return {
    days,
    steps,
    dropOff,
    splits: [
      splitBy(inputs.funnel, 'Device', (row) => deviceOf(row.device_class)),
      splitBy(inputs.funnel, 'UTM source', (row) => sourceOf(row.utm_source)),
      splitBy(inputs.funnel, 'Referring site', (row) => referrerOf(row.referrer_host)),
    ],
    evaluationsByChannel: [
      evaluationSplit(inputs, 'UTM source', (channel) => sourceOf(channel?.utm_source)),
      evaluationSplit(inputs, 'Referring site', (channel) => referrerOf(channel?.referrer_host)),
      evaluationSplit(inputs, 'Device', (channel) => deviceOf(channel?.device_class)),
    ],
    timings,
    daily: [...daily.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([day, counts]) => ({ day, counts })),
    browserStepKeys: BROWSER_STEPS.map((step) => step.key),
  }
}
