import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import {
  buildCaseCapabilityBillingResponse,
  type CaseEntitlementCapabilityRow,
  type CasePurchaseCapabilityRow,
} from "@/lib/billing/case-capabilities"
import { createUserClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { caseId } = await params
  const supabase = await createUserClient()
  const { data: caseRow, error: caseError } = await supabase
    .from("cases")
    .select("id, user_id")
    .eq("id", caseId)
    .maybeSingle()

  if (caseError) {
    return NextResponse.json({ error: "Failed to load case capabilities" }, { status: 500 })
  }
  if (!caseRow) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 })
  }

  const canPurchase = caseRow.user_id === user.supabaseUuid
  const [entitlementResult, purchasesResult] = await Promise.all([
    supabase
      .from("case_entitlements")
      .select("plan, features, purchased_at")
      .eq("case_id", caseId)
      .maybeSingle(),
    supabase
      .from("case_purchases")
      .select("id, product_code, payment_status, paid_at, created_at")
      .eq("case_id", caseId)
      .order("created_at", { ascending: false }),
  ])

  if (entitlementResult.error || purchasesResult.error) {
    return NextResponse.json({ error: "Failed to load case capabilities" }, { status: 500 })
  }

  return NextResponse.json(
    buildCaseCapabilityBillingResponse({
      caseId,
      entitlement: entitlementResult.data as CaseEntitlementCapabilityRow | null,
      purchases: (purchasesResult.data ?? []) as CasePurchaseCapabilityRow[],
      canPurchase,
    }),
    { headers: { "Cache-Control": "no-store" } },
  )
}
