import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { createUserClient } from "@/lib/supabase/server"

export async function POST() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = await createUserClient()
    const { data: referralCode, error } = await supabase.rpc("ensure_my_referral_code")

    if (error || typeof referralCode !== "string") {
      throw error ?? new Error("Referral code was not returned")
    }

    return NextResponse.json({ referralCode })
  } catch (error) {
    console.error("[v0] Referral generation error:", error)
    return NextResponse.json({ error: "Failed to generate referral code" }, { status: 500 })
  }
}
