import { updateSession } from "@/lib/supabase/middleware"
import type { NextRequest } from "next/server"

const blockedPathPatterns: RegExp[] = [
  /\.env/i,
  /^\/?\.git/i,
  /wp-(?:includes|admin)/i,
  /xmlrpc\.php/i,
  /wlwmanifest\.xml/i,
  /config\.(?:js|json)/i,
]

const blockedUserAgents: RegExp[] = [/aiohttp/i, /cms-checker/i]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const userAgent = request.headers.get("user-agent") ?? ""

  if (blockedPathPatterns.some((pattern) => pattern.test(pathname)) || blockedUserAgents.some((pattern) => pattern.test(userAgent))) {
    return new Response("Not found", { status: 404 })
  }

  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
