'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useSupabaseBrowser } from '@/hooks/state-machine/use-supabase-browser'

const RealtimeContext = createContext<SupabaseClient | null>(null)

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const supabase = useSupabaseBrowser()
  const value = useMemo(() => supabase, [supabase])
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}

export function useRealtimeClient() {
  const client = useContext(RealtimeContext)
  if (!client) {
    throw new Error('useRealtimeClient must be used within RealtimeProvider')
  }
  return client
}
