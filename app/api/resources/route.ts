import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(
    {
      error: {
        code: 'resources_unavailable',
        message: 'Our verified resources directory is under development.',
      },
    },
    {
      status: 503,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': '3600',
      },
    },
  )
}
