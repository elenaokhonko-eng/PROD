/**
 * Server-side Supabase clients — Pattern C (Clerk JWT → Supabase Third-Party Auth).
 *
 * - `createUserClient()` — anon-key client with the Clerk-signed JWT attached,
 *   so RLS treats every query as the authenticated user. Use this for any
 *   read/write that must respect RLS (ownership probes, user-scoped inserts).
 *
 * Reference: docs/Front-to-Back-End-Integration-Summary.md §9.2 and §10.4.
 */

import { auth } from '@clerk/nextjs/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * User-scoped Supabase client. Forwards the Clerk-signed JWT so `auth.uid()`
 * in RLS policies returns the same UUID stored on `cases.user_id`.
 *
 * Throws a readable error if the caller has no active Clerk session — all
 * user-scoped routes must handle this upstream by returning 401.
 */
export async function createUserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error('Supabase user client is not configured (missing URL or anon key)')
  }

  const { userId, getToken } = await auth()
  if (!userId) {
    throw new Error('createUserClient called without an active Clerk session')
  }

  const token = await getToken({ template: 'supabase' })
  if (!token) {
    throw new Error(
      'Clerk did not return a Supabase JWT — verify the "supabase" JWT template is configured (see docs/runbooks/slice-0-auth-reconciliation.md §3.1)',
    )
  }

  return createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}
