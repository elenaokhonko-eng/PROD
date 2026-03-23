import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse, type NextRequest } from 'next/server'

const blockedPathPatterns: RegExp[] = [
  /\.env/i,
  /^\/?\.git/i,
  /wp-(?:includes|admin)/i,
  /xmlrpc\.php/i,
  /wlwmanifest\.xml/i,
  /config\.(?:js|json)/i,
]

const blockedUserAgents: RegExp[] = [/aiohttp/i, /cms-checker/i]

const isProtectedRoute = createRouteMatcher(['/app(.*)'])
const isPublicAppRoute = createRouteMatcher(['/app/signup'])

export default clerkMiddleware(async function proxy(auth, request: NextRequest) {
  const { pathname } = request.nextUrl
  const userAgent = request.headers.get('user-agent') ?? ''

  if (
    blockedPathPatterns.some((pattern) => pattern.test(pathname)) ||
    blockedUserAgents.some((pattern) => pattern.test(userAgent))
  ) {
    return new NextResponse('Not found', { status: 404 })
  }

  if (isProtectedRoute(request) && !isPublicAppRoute(request)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
