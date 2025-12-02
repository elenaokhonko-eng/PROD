import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"

const isPublicHost = (value: string) => {
  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`)
    const host = url.hostname.toLowerCase()
    return host.includes(".") && host !== "localhost" && host !== "127.0.0.1"
  } catch {
    return false
  }
}

const chooseRedirectOrigin = (fallbackOrigin: string) => {
  const candidates = [
    process.env.PUBLIC_AUTH_REDIRECT_BASE,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL,
    fallbackOrigin,
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    if (isPublicHost(candidate)) {
      try {
        return new URL(candidate.startsWith("http") ? candidate : `https://${candidate}`).origin
      } catch {
        continue
      }
    }
  }
  return fallbackOrigin
}

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
  const redirectOrigin = chooseRedirectOrigin(requestUrl.origin)
  const nextUrl = decodeNextPath(nextParam, redirectOrigin)

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
