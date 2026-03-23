import { NextResponse } from "next/server"

import { trackServerEvent } from "@/lib/analytics/server"
import { getOrCreateProfile } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/service"

export async function POST(request: Request) {
  const user = await getOrCreateProfile()

  const { token } = await request.json()
  if (!token) {
    return NextResponse.json({ error: "Session token is required" }, { status: 400 })
  }

  const supabaseService = createServiceClient()

  // Fetch session regardless of prior status/user, then reconcile ownership.
  const { data: rawSession, error: sessionError } = await supabaseService
    .from("router_sessions")
    .select("*")
    .eq("session_token", token)
    .maybeSingle()

  if (sessionError) {
    console.error(`[Create Case] Error fetching router session ${token}:`, sessionError)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  if (!rawSession) {
    console.warn(`[Create Case] No router session found for token ${token}`)
    return NextResponse.json({ error: "No convertible session found" }, { status: 404 })
  }

  const sessionUserId = rawSession.converted_to_user_id
  const activeUserId = user?.profileId ?? sessionUserId

  if (!activeUserId) {
    console.warn(`[Create Case] No active user for session ${token}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // If already imported with a case, return the existing case ID
  if (rawSession.status === "IMPORTED" && rawSession.converted_to_case_id) {
    console.info(
      `[Create Case] Session ${token} already imported as case ${rawSession.converted_to_case_id}`,
    )
    return NextResponse.json({
      success: true,
      caseId: rawSession.converted_to_case_id,
      message: "Session was already imported",
    })
  }

  if (rawSession.converted_to_user_id && rawSession.converted_to_user_id !== activeUserId) {
    console.warn(
      `[Create Case] Session ${token} already linked to another user ${rawSession.converted_to_user_id}. Current user: ${activeUserId}`,
    )
    return NextResponse.json({ error: "Session already linked to another user" }, { status: 403 })
  }

  // Attach session to this user if not already.
  if (!rawSession.converted_to_user_id) {
    const { error: claimError } = await supabaseService
      .from("router_sessions")
      .update({
        converted_to_user_id: activeUserId,
        status: "CONVERTED",
        converted_at: new Date().toISOString(),
      })
      .eq("session_token", token)

    if (claimError) {
      console.error(`[Create Case] Failed to claim session ${token} for user ${activeUserId}:`, claimError)
      return NextResponse.json({ error: "Failed to claim session" }, { status: 500 })
    }
  }

  const routerSession = {
    ...rawSession,
    converted_to_user_id: activeUserId,
    status: "CONVERTED",
  }

  const claimType =
    (routerSession.classification_result as { claimType?: string } | null)?.claimType || "Scam"

  const normalizeClaimType = (subtype: string | null | undefined) => {
    const value = (subtype || "").toLowerCase().trim()
    if (value.includes("fraud") || value.includes("scam")) return "phishing_scam"
    if (value.includes("mis-sold") || value.includes("missold") || value.includes("mis sold")) return "mis_sold_product"
    if (value.includes("insurance")) return "denied_insurance"
    // Default to a valid value that passes the DB check constraint
    return "phishing_scam"
  }

  // Ensure profile exists for FK constraints
  const { error: profileUpsertError } = await supabaseService.from("profiles").upsert(
    {
      id: activeUserId,
      email: user?.email ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  )
  if (profileUpsertError) {
    console.error(`[Create Case] Failed to upsert profile for user ${activeUserId}:`, profileUpsertError)
    return NextResponse.json({ error: "Failed to prepare user profile" }, { status: 500 })
  }

  const { data: newCase, error: caseError } = await supabaseService
    .from("cases")
    .insert({
      user_id: activeUserId,
      claim_type: normalizeClaimType(claimType),
      case_summary: routerSession.dispute_narrative ?? null,
      status: "draft",
    })
    .select("id")
    .single()

  if (caseError) {
    console.error(`[Create Case] Error creating new case for user ${activeUserId}:`, caseError)
    return NextResponse.json({ error: "Failed to create case" }, { status: 500 })
  }

  const { error: updateError } = await supabaseService
    .from("router_sessions")
    .update({
      status: "IMPORTED",
      converted_to_case_id: newCase.id,
    })
    .eq("id", routerSession.id)

  if (updateError) {
    console.warn(`[Create Case] Failed to mark session ${routerSession.id} as imported:`, updateError)
  }

  try {
    await trackServerEvent({
      eventName: "router_conversion_imported",
      userId: activeUserId,
      sessionId: routerSession.session_token,
      eventData: {
        case_id: newCase.id,
        recommended_path: routerSession.recommended_path,
      },
    })
  } catch (err) {
    console.warn("[Create Case] Failed to log analytics for router conversion:", err)
  }

  return NextResponse.json({
    success: true,
    caseId: newCase.id,
    message: "Case created from session",
  })
}
