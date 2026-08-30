"use client"

import { useEffect } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { trackClientEvent } from "@/lib/analytics/client"

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
        sessionId: null,
        pageUrl: pageUrl ?? undefined,
      })
    }

    void fire()
  }, [pathname, searchParams])

  return null
}
