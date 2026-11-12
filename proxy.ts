import { clerkMiddleware } from '@clerk/nextjs/server'
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server'

const blockedPathPatterns: RegExp[] = [
  /\.env/i,
  /^\/?\.git/i,
  /wp-(?:includes|admin)/i,
  /xmlrpc\.php/i,
  /wlwmanifest\.xml/i,
  /config\.(?:js|json)/i,
]
const blockedUserAgents: RegExp[] = [/aiohttp/i, /cms-checker/i]
const isPublicAppRoute = (request: NextRequest) => request.nextUrl.pathname === '/app/signup'
const needsAuthentication = (request: NextRequest) => {
  const { pathname } = request.nextUrl
  return (pathname === '/app' || pathname.startsWith('/app/')) && !isPublicAppRoute(request)
}
const hasClerkConfig = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
const withClerk = hasClerkConfig
  ? clerkMiddleware(async (auth, request) => {
      if (needsAuthentication(request)) await auth.protect()
    })
  : null

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl
  const userAgent = request.headers.get('user-agent') ?? ''

  if (
    blockedPathPatterns.some((pattern) => pattern.test(pathname)) ||
    blockedUserAgents.some((pattern) => pattern.test(userAgent))
  ) {
    return new NextResponse('Not found', { status: 404 })
  }

  if (
    process.env.NODE_ENV !== 'production' &&
    process.env.HARBOR_VISUAL_FIXTURES === '1' &&
    !needsAuthentication(request)
  ) {
    return NextResponse.next()
  }

  if (!hasClerkConfig) {
    if (isPublicAppRoute(request)) return NextResponse.redirect(new URL('/sign-up', request.url))
    return needsAuthentication(request)
      ? new NextResponse('Authentication is not configured.', { status: 503 })
      : NextResponse.next()
  }

  return withClerk!(request, event)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
