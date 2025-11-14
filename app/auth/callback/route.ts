import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"

const decodeNextPath = (value: string | null, origin: string) => {
  if (!value) {
    return new URL("/app", origin)
  }

  try {
    const decoded = decodeURIComponent(value)
    return new URL(decoded, origin)
  } catch {
    return new URL(value, origin)
  }
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const nextParam = requestUrl.searchParams.get("next")
  const nextUrl = decodeNextPath(nextParam, requestUrl.origin)

  const response = NextResponse.redirect(nextUrl)

  if (!code) {
    return response
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SP_PUBLISHABLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    console.error("[Auth Callback] Missing Supabase configuration for code exchange.")
    return response
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options)
        })
      },
    },
  })

  try {
    await supabase.auth.exchangeCodeForSession(code)
  } catch (error) {
    console.error("[Auth Callback] Failed to exchange code for session:", error)
  }

  return response
}
