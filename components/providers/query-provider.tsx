'use client'

/**
 * TanStack Query provider — shared cache for every State Machine data hook.
 *
 * Placed INSIDE `ClerkProvider` in `app/layout.tsx` so all child client components
 * (including those that later read the Clerk session for Supabase JWTs) see
 * both contexts.
 *
 * Defaults are tuned for the State Machine usage patterns:
 * - staleTime 30s — most edge-function outputs don't change fast; aggressive
 *   caching keeps the UI snappy across navigation.
 * - gcTime 5min — keep caches warm when the user hops between case screens.
 * - retry: 1 — edge functions do their own retries; we just want one polite try.
 * - refetchOnWindowFocus: false — avoids re-firing expensive RPCs every tab
 *   switch; Realtime hooks push fresh data on their own.
 *
 * Realtime hooks invalidate this cache directly via `queryClient.setQueryData`.
 */

import { useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
          mutations: {
            retry: 0,
          },
        },
      }),
  )

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
