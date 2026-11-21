"use client"

import { useEffect } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { trackClientEvent } from "@/lib/analytics/client"

// A random number per browser tab (sessionStorage, gone when the tab closes) so Analytics 1 can count visits. It is
// its own number, not the journey tracking's, so page views and journey steps cannot be joined.
const SESSION_KEY = "gb-pageview-session"

function tabSession(): string | null {
  try {
    const storage = window.sessionStorage
    const existing = storage.getItem(SESSION_KEY)
    if (existing) return existing
    const id = crypto.randomUUID()
    storage.setItem(SESSION_KEY, id)
    return id
  } catch {
    return null
  }
}

export function PageViewTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    const fire = async () => {
      const pageUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}${pathname}${searchParams?.toString() ? `?${searchParams.toString()}` : ""}`
          : null

      await trackClientEvent({
        eventName: "page_view",
        sessionId: tabSession(),
        pageUrl: pageUrl ?? undefined,
      })
    }

    void fire()
  }, [pathname, searchParams])

  return null
}
