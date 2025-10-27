import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

export default async function AppSignupPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect("/app/case/new")
  }

  redirect("/auth/sign-up")
}
