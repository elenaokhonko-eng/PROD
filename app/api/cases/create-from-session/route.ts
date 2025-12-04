import { NextResponse } from "next/server"

import { trackServerEvent } from "@/lib/analytics/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

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
  const activeUserId = user?.id ?? sessionUserId

  if (!activeUserId) {
    console.warn(`[Create Case] No active user for session ${token}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
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

  const claimSubtype =
    (routerSession.classification_result as { claimSubtype?: string } | null)?.claimSubtype ||
    (routerSession.classification_result as { claimType?: string } | null)?.claimType ||
    "Phishing Scam"

  const { data: newCase, error: caseError } = await supabaseService
    .from("cases")
    .insert({
      user_id: activeUserId,
      claim_type: claimSubtype,
      dispute_narrative: routerSession.dispute_narrative ?? null,
    })
    .select("id")
    .single()

  if (caseError) {
    console.error(`[Create Case] Error creating new case for user ${user.id}:`, caseError)
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

  trackServerEvent({
    eventName: "router_conversion_imported",
    userId: user.id,
    sessionId: routerSession.session_token,
    eventData: {
      case_id: newCase.id,
      recommended_path: routerSession.recommended_path,
    },
  })

  return NextResponse.json({
    success: true,
    caseId: newCase.id,
    message: "Case created from session",
  })
}
