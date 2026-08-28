/**
 * Pattern C auth helper — Clerk session plus Supabase-scoped identity from the JWT.
 *
 * `userId` is the Clerk user id. `supabaseUuid` comes from the Clerk JWT template
 * (`getToken({ template: 'supabase' })`): it must match `public.profiles.id` and
 * what RLS treats as the row owner (`cases.user_id`, etc.).
 *
 * Server routes that talk to Supabase with `createUserClient()` should use
 * `supabaseUuid` for ownership and application identity columns; use `userId`
 * only for Clerk API calls and external Clerk references.
 */

import { auth } from '@clerk/nextjs/server'

export type CurrentUser = { userId: string; supabaseUuid: string }

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.')
  if (parts.length < 2) throw new Error('invalid jwt')
  const base64url = parts[1]
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  return JSON.parse(Buffer.from(b64 + pad, 'base64').toString('utf8'))
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const { userId, getToken } = await auth()
  if (!userId) return null

  const token = await getToken({ template: 'supabase' })
  if (!token) return null

  let payload: Record<string, unknown>
  try {
    payload = decodeJwtPayload(token)
  } catch {
    return null
  }

  const supabaseUuid = payload.supabase_uuid
  if (typeof supabaseUuid !== 'string' || !supabaseUuid) return null

  return { userId, supabaseUuid }
}
