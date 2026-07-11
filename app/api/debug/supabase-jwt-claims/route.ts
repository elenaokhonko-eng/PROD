import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

export const runtime = 'nodejs'

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.')
  if (!payload) throw new Error('Invalid JWT payload')

  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>
}

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { getToken, sessionId, userId } = await auth()
  const token = await getToken({ template: 'supabase' })
  if (!token) {
    return NextResponse.json(
      {
        error: 'Missing Supabase JWT',
        userId,
        hasSession: Boolean(sessionId),
      },
      { status: 401 },
    )
  }

  const claims = decodeJwtPayload(token)
  const sub = typeof claims.sub === 'string' ? claims.sub : null
  const supabaseUuid =
    typeof claims.supabase_uuid === 'string' ? claims.supabase_uuid : null
  const expectedUuid = '31daa072-e0f4-40cb-927b-8724e781843d'

  return NextResponse.json({
    role: typeof claims.role === 'string' ? claims.role : null,
    sub,
    supabase_uuid: supabaseUuid,
    subMatchesSupabaseUuid: Boolean(sub && supabaseUuid && sub === supabaseUuid),
    subMatchesExpectedUuid: sub === expectedUuid,
    supabaseUuidMatchesExpectedUuid: supabaseUuid === expectedUuid,
  })
}
