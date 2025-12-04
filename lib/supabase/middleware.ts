import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SP_PUBLISHABLE_KEY

  // If Supabase is not configured, skip auth check and continue
  if (!supabaseUrl || !supabasePublishableKey) {
    console.warn("[v0] Supabase environment variables not found. Skipping auth check.")
    return supabaseResponse
  }

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        supabaseResponse = NextResponse.next({
          request,
        })
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
      },
    },
  })

  const {
    data: { user },
    error: getUserError,
  } = await supabase.auth.getUser()

  // If the cookie is stale (user_not_found), try to refresh once and otherwise continue
  if (getUserError && /user_not_found/i.test(getUserError.message || "")) {
    const { error: refreshError } = await supabase.auth.refreshSession()
    if (refreshError) {
      console.warn("[middleware] Failed to refresh stale session:", refreshError.message)
    }
  }

  // Protect app routes (except auth routes)
  if (
    request.nextUrl.pathname.startsWith("/app") &&
    !request.nextUrl.pathname.startsWith("/app/signup") &&
    !user &&
    !request.nextUrl.pathname.startsWith("/auth")
  ) {
    const url = request.nextUrl.clone()
    url.pathname = "/auth/login"
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
