import { createClient } from "@supabase/supabase-js"

export function createClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SP_PUBLISHABLE_KEY!)
}
