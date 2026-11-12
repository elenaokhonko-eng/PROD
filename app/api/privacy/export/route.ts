import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { createUserClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { safeErrorText } from "@/lib/server/safe-error"

type IdRow = { id: string }

// What the user wrote and confirmed, and the facts extracted from it (fact reconciliation, migration 38).
const FACT_TABLES = [
  "case_story_revisions",
  "case_response_revisions",
  "case_fact_reconcile_runs",
  "case_fact_candidates",
  "case_fact_findings",
  "case_fact_snapshots",
  "case_fact_confirmation_events",
] as const

// Model-call metering for the user's cases and account (cost-controls B6): IDs, tokens, cost and outcome only; the
// table holds no text. It is service-role only, so it is read with the service client for the case IDs the user's own
// client returned above, and for rows carrying the user's profile ID.
const MODEL_USAGE_COLUMNS =
  "id, created_at, purpose, provider, model, input_tokens, cached_input_tokens, output_tokens, outcome, estimated_cost_usd, case_id"

async function modelUsageFor(caseIds: string[], profileId: string) {
  const service = createServiceClient()
  const [byCase, byUser] = await Promise.all([
    caseIds.length ? service.from("model_usage").select(MODEL_USAGE_COLUMNS).in("case_id", caseIds) : Promise.resolve({ data: [], error: null }),
    service.from("model_usage").select(MODEL_USAGE_COLUMNS).eq("user_id", profileId),
  ])
  const error = byCase.error ?? byUser.error
  const rows = new Map<string, Record<string, unknown>>()
  for (const row of [...(byCase.data ?? []), ...(byUser.data ?? [])] as Array<Record<string, unknown>>) rows.set(String(row.id), row)
  return { data: [...rows.values()], error }
}

export async function POST() {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const supabase = await createUserClient()

    const { data: ownedCases, error: ownedCasesError } = await supabase
      .from("cases")
      .select("id")
      .eq("user_id", user.supabaseUuid)

    if (ownedCasesError) {
      console.error("[privacy] failed to load owned cases:", safeErrorText(ownedCasesError))
      return NextResponse.json({ error: "Failed to export data" }, { status: 500 })
    }

    const ownedCaseIds = (ownedCases ?? []).map((row: IdRow) => row.id)

    // Pull primary user data
    const responsesPromise =
      ownedCaseIds.length > 0
        ? supabase.from("case_responses").select("*").in("case_id", ownedCaseIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[], error: null })

    const outcomesPromise =
      ownedCaseIds.length > 0
        ? supabase.from("case_outcomes").select("*").in("case_id", ownedCaseIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[], error: null })

    const factsPromise = Promise.all(
      FACT_TABLES.map((table) =>
        ownedCaseIds.length > 0
          ? supabase.from(table).select("*").in("case_id", ownedCaseIds)
          : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
      ),
    )

    const [profileResult, casesResult, responsesResult, paymentsResult, outcomesResult, factResults, usageResult] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.supabaseUuid).single(),
      supabase.from("cases").select("*").eq("user_id", user.supabaseUuid),
      responsesPromise,
      supabase.from("payments").select("*").eq("user_id", user.supabaseUuid),
      outcomesPromise,
      factsPromise,
      modelUsageFor(ownedCaseIds, user.supabaseUuid),
    ])

    const failedQuery = [
      { label: "profile", error: profileResult.error },
      { label: "cases", error: casesResult.error },
      { label: "case responses", error: responsesResult.error },
      { label: "payments", error: paymentsResult.error },
      { label: "case outcomes", error: outcomesResult.error },
      ...FACT_TABLES.map((table, i) => ({ label: table, error: factResults[i].error })),
      { label: "model usage", error: usageResult.error },
    ].find((result) => result.error)

    if (failedQuery) {
      console.error(`[privacy] failed to export ${failedQuery.label}:`, safeErrorText(failedQuery.error))
      return NextResponse.json({ error: "Failed to export data" }, { status: 500 })
    }

    const profile = profileResult.data ?? null
    const cases = casesResult.data ?? []
    const responses = responsesResult.data ?? []
    const payments = paymentsResult.data ?? []
    const outcomes = outcomesResult.data ?? []

    const exportPayload = {
      generated_at: new Date().toISOString(),
      user: { id: user.supabaseUuid, email: profile?.email ?? null },
      profile,
      cases,
      case_responses: responses,
      payments,
      case_outcomes: outcomes,
      ...Object.fromEntries(FACT_TABLES.map((table, i) => [table, factResults[i].data ?? []])),
      model_usage: usageResult.data,
    }

    return NextResponse.json(exportPayload)
  } catch (err) {
    console.error("[privacy] export error:", safeErrorText(err))
    return NextResponse.json({ error: "Failed to export data" }, { status: 500 })
  }
}
