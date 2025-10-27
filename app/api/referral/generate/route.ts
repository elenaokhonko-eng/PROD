import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

function generateReferralCode(userId: string): string {
  // Generate a short, memorable referral code
  const prefix = userId.substring(0, 4).toUpperCase()
  const random = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `${prefix}${random}`
}

export async function POST() {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Check if user already has a referral code
    const { data: profile } = await supabase.from("profiles").select("referral_code").eq("id", user.id).single()

    if (profile?.referral_code) {
      return NextResponse.json({ referralCode: profile.referral_code })
    }

    // Generate new referral code
    let referralCode = generateReferralCode(user.id)
    let attempts = 0
    const maxAttempts = 5

    // Ensure uniqueness
    while (attempts < maxAttempts) {
      const { data: existing } = await supabase.from("profiles").select("id").eq("referral_code", referralCode).single()

      if (!existing) break

      referralCode = generateReferralCode(user.id)
      attempts++
    }

    // Update profile with referral code
    const { error } = await supabase.from("profiles").update({ referral_code: referralCode }).eq("id", user.id)

    if (error) {
      throw error
    }

    return NextResponse.json({ referralCode })
  } catch (error) {
    console.error("[v0] Referral generation error:", error)
    return NextResponse.json({ error: "Failed to generate referral code" }, { status: 500 })
  }
}
