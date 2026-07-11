'use client'

/**
 * Browser-side Supabase client — Pattern C, used for Realtime subscriptions.
 *
 * The caller (typically `components/providers/realtime-provider.tsx`) passes
 * a `getToken` callback that returns a fresh Clerk-signed Supabase JWT. The
 * client transparently calls this before each request and every WebSocket
 * reconnect, so RLS stays enforced on both table reads and Realtime filters.
 *
 * Reference: docs/Front-to-Back-End-Integration-Summary.md §9.2 + §9.3;
 * docs/State-Machine-Workflow.md §8.2 (reconnect backoff).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cachedClient: SupabaseClient | null = null

type TokenFetcher = () => Promise<string | null>

/**
 * Build (or return the cached) browser Supabase client. The client is built
 * once per tab so Realtime channels are reused instead of stacked.
 *
 * `getToken` MUST return a Clerk-signed Supabase JWT (Clerk's `getToken({
 * template: 'supabase' })`). It will be invoked on every request and on
 * socket reconnect.
 */
export function createBrowserClient(getToken: TokenFetcher): SupabaseClient {
  if (cachedClient) return cachedClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      'Supabase browser client is not configured (NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required)',
    )
  }

  cachedClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const token = await getToken()
        const headers = new Headers(init?.headers)
        if (token) headers.set('Authorization', `Bearer ${token}`)
        return fetch(input, { ...init, headers })
      },
    },
    realtime: {
      params: {
        // accessToken gets refreshed on every reconnect via `setAuth` below.
        eventsPerSecond: 10,
      },
    },
  })

  // Wire Realtime auth refresh: whenever a new token is fetched, push it to
  // the WebSocket so RLS filters stay valid after token rotation.
  void getToken().then((initial) => {
    if (initial) cachedClient!.realtime.setAuth(initial)
  })

  return cachedClient
}

/** Test/support helper — clears the module-level singleton so tests can build
 *  a fresh client per test. Do NOT call from production code. */
export function __resetBrowserClientForTests() {
  cachedClient = null
}
