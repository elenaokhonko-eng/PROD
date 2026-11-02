import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { createUserClient } from "@/lib/supabase/server"

type DeletionRequest = {
  request_id: string
  request_status: string
  requested_at: string
}

export async function POST() {
  const currentUser = await getCurrentUser()
  if (!currentUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = await createUserClient()
  const { data, error } = await supabase.rpc("request_privacy_deletion")
  if (error) {
    console.error("[privacy] deletion request enqueue failed:", error)
    return NextResponse.json({ error: "Failed to submit deletion request" }, { status: 500 })
  }

  const request = (Array.isArray(data) ? data[0] : data) as DeletionRequest | null
  if (!request?.request_id || !request.request_status || !request.requested_at) {
    console.error("[privacy] deletion request returned an invalid result")
    return NextResponse.json({ error: "Failed to verify deletion request" }, { status: 500 })
  }

  return NextResponse.json(
    {
      request: {
        id: request.request_id,
        status: request.request_status,
        requestedAt: request.requested_at,
      },
      message: "Deletion request queued for review; no data has been deleted.",
    },
    { status: 202 },
  )
}
