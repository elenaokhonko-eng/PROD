'use client'

/**
 * Shared helper — returns the module-level Supabase browser client wired to
 * the current Clerk session's `supabase` JWT template.
 *
 * Every Layer 1/2/3 data hook calls this. Keeping it in one place means:
 *
 * 1. There is a single token refresh path (`useAuth().getToken`). If Clerk's
 *    signature ever changes, we edit here, not in 10 hooks.
 * 2. Realtime subscriptions all share one WebSocket — hooks that mount/unmount
 *    on navigation don't stack connections.
 * 3. When the user signs out, `getToken()` returns `null`; requests then go
 *    unauthenticated and RLS blocks them, which is the correct behaviour.
 *
 * Reference: IS §9.2 + §9.3; SM §8.2 (reconnect backoff).
 */

import { useMemo } from 'react'
import { useAuth } from '@clerk/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createBrowserClient } from '@/lib/supabase/browser'

export function useSupabaseBrowser(): SupabaseClient {
  const { getToken } = useAuth()

  return useMemo(
    () =>
      createBrowserClient(async () => {
        if (typeof window === 'undefined') {
          return Promise.resolve(null)
        }
        try {
          const token = await getToken({ template: 'supabase' })
          return token
        } catch (error) {
          return null
        }
      }),
    [getToken],
  )
}
