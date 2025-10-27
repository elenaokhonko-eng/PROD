"use client"

import React, { createContext, useContext, useMemo, useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"

type SupabaseContextValue = {
  supabase: SupabaseClient
}

const SupabaseContext = createContext<SupabaseContextValue | undefined>(undefined)

export function SupabaseProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => createClient())

  const value = useMemo(() => ({ supabase: client }), [client])

  return <SupabaseContext.Provider value={value}>{children}</SupabaseContext.Provider>
}

export function useSupabase(): SupabaseClient {
  const ctx = useContext(SupabaseContext)
  if (!ctx) {
    throw new Error("useSupabase must be used within a SupabaseProvider")
  }
  return ctx.supabase
}


