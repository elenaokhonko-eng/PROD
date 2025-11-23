"use client"

import { useEffect } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { trackClientEvent } from "@/lib/analytics/client"
import { createRouterSession, getSessionToken } from "@/lib/router-session"

export function PageViewTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    const fire = async () => {
      let sessionToken = getSessionToken()
      if (!sessionToken) {
        const session = await createRouterSession()
        sessionToken = session?.session_token ?? null
      }

      const pageUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}${pathname}${searchParams?.toString() ? `?${searchParams.toString()}` : ""}`
          : null

      await trackClientEvent({
        eventName: "page_view",
        sessionId: sessionToken ?? undefined,
        pageUrl: pageUrl ?? undefined,
      })
    }

    void fire()
  }, [pathname, searchParams])

  return null
}
