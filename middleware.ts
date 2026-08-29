import { clerkMiddleware } from '@clerk/nextjs/server'
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server'

const withClerk = clerkMiddleware()

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  if (process.env.NODE_ENV !== 'production' && process.env.HARBOR_VISUAL_FIXTURES === '1') {
    return NextResponse.next()
  }

  return withClerk(request, event)
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
