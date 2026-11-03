import { createClient } from "@supabase/supabase-js"

import { getCurrentUser } from "@/lib/auth"

// The case hooks send the Clerk "supabase" template JWT as a Bearer token (as checkout and job status expect), but
// Clerk rejects that header as a session, so cookie-based getCurrentUser() alone returns nothing for those calls.
// Accept either. A bearer claim is only trusted after Supabase has verified the token: current_app_user_id() runs
// under that token and returns the signed supabase_uuid, or fails.
export async function resolveRequestSupabaseUuid(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization")
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : ""
  if (!bearer) {
    const user = await getCurrentUser()
    return user?.supabaseUuid ?? null
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) return null

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${bearer}` } },
  })
  const { data, error } = await client.rpc("current_app_user_id")
  if (error || typeof data !== "string" || !data) return null
  return data
}
