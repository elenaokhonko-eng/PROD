import { clerkMiddleware } from '@clerk/nextjs/server'
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server'

const withClerk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? clerkMiddleware() : null

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  if (
    (process.env.NODE_ENV !== 'production' && process.env.HARBOR_VISUAL_FIXTURES === '1') ||
    (process.env.NODE_ENV !== 'production' && !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
  ) {
    return NextResponse.next()
  }

  return withClerk ? withClerk(request, event) : NextResponse.next()
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
