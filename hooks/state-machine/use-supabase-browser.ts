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
          // #region agent log
          fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',runId:'initial-debug',hypothesisId:'H1',location:'use-supabase-browser.ts:32',message:'useSupabaseBrowser token fetch skipped on server',data:{hasWindow:false},timestamp:Date.now()})}).catch(()=>{})
          // #endregion
          return Promise.resolve(null)
        }
        try {
          const token = await getToken({ template: 'supabase' })
          // #region agent log
          fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',runId:'initial-debug',hypothesisId:'H1',location:'use-supabase-browser.ts:38',message:'useSupabaseBrowser getToken resolved',data:{hasToken:Boolean(token),hasWindow:true},timestamp:Date.now()})}).catch(()=>{})
          // #endregion
          return token
        } catch (error) {
          // #region agent log
          fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',runId:'initial-debug',hypothesisId:'H1',location:'use-supabase-browser.ts:43',message:'useSupabaseBrowser getToken threw',data:{errorMessage:error instanceof Error ? error.message : 'unknown'},timestamp:Date.now()})}).catch(()=>{})
          // #endregion
          return null
        }
      }),
    [getToken],
  )
}
