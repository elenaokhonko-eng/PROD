import { clerkMiddleware } from '@clerk/nextjs/server'
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server'
import { allowedHosts, hostAllowed } from '@/lib/host-allowlist'
import { isProbe } from '@/lib/security/probe-paths'
import { ORIGIN_AUTH_HEADER, originAllowed } from '@/lib/security/origin-check'
import {
  MARKDOWN_REWRITE_HEADER,
  MARKDOWN_ROUTE_PREFIX,
  markdownNameForPath,
  markdownNameForRoute,
  prefersMarkdown,
} from '@/lib/seo/markdown'

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
const ALLOWED_HOSTS = allowedHosts()
const hasClerkConfig = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
const withClerk = hasClerkConfig
  ? clerkMiddleware(async (auth, request) => {
      if (needsAuthentication(request)) await auth.protect()
    })
  : null

// Brief W1 Addendum S2: scanner probes get a tiny 404 before anything else runs. No cookies, never cached, and the
// query string is never logged.
const probeResponse = () =>
  new NextResponse('Not found', { status: 404, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } })

// The path as the client sent it, still percent-encoded (nextUrl.pathname may decode %2F and friends).
function rawPathAndUri(url: string): { path: string; uri: string } {
  const afterHost = url.replace(/^[a-z]+:\/\/[^/]+/i, '') || '/'
  const query = afterHost.indexOf('?')
  return { path: query === -1 ? afterHost : afterHost.slice(0, query), uri: afterHost }
}

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl
  const userAgent = request.headers.get('user-agent') ?? ''

  const raw = rawPathAndUri(request.url)
  if (isProbe(raw.path, raw.uri) || isProbe(pathname)) return probeResponse()

  // Addendum S3.2: refuse requests that did not come through Cloudflare (on once ORIGIN_AUTH_SECRET is set).
  if (!originAllowed(pathname, request.headers.get(ORIGIN_AUTH_HEADER), process.env.ORIGIN_AUTH_SECRET, process.env.ORIGIN_AUTH_MODE)) {
    return probeResponse()
  }

  if (!hostAllowed(request.headers.get('host'), pathname, ALLOWED_HOSTS)) {
    return new NextResponse('Not found', { status: 404 })
  }

  if (
    blockedPathPatterns.some((pattern) => pattern.test(pathname)) ||
    blockedUserAgents.some((pattern) => pattern.test(userAgent))
  ) {
    return probeResponse()
  }

  // Addendum M §M3: a page's markdown copy, at its ".md" address or when the Accept header asks for markdown. The choice
  // depends only on the address and the Accept header, never on who is asking.
  if (pathname.startsWith(MARKDOWN_ROUTE_PREFIX)) return new NextResponse('Not found', { status: 404 })
  const wantsCopy = request.method === 'GET' || request.method === 'HEAD'
  const markdownName = wantsCopy
    ? markdownNameForPath(pathname) ?? (prefersMarkdown(request.headers.get('accept')) ? markdownNameForRoute(pathname) : null)
    : null
  if (markdownName) {
    const headers = new Headers(request.headers)
    headers.set(MARKDOWN_REWRITE_HEADER, '1')
    return NextResponse.rewrite(new URL(`${MARKDOWN_ROUTE_PREFIX}${markdownName}`, request.url), { request: { headers } })
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
    // Skip Next.js internals and all static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
    // Scanner probes for JavaScript files that the static-file rule above would otherwise skip (Addendum S2).
    '/__env.js',
    '/credentials.js',
    '/next.config.js',
  ],
}
