"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@clerk/nextjs"
import { readAndClearPendingNarrative, persistPendingNarrative } from "@/components/landing/hero-capture"

export function PendingNarrativeHandoff() {
  const { isSignedIn } = useAuth()
  const router = useRouter()
  const handled = useRef(false)

  useEffect(() => {
    if (!isSignedIn || handled.current) return

    const pending = readAndClearPendingNarrative()
    if (!pending) return

    handled.current = true

    void fetch("/api/cases/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pending),
    })
      .then((r) => r.json())
      .then(({ case_id }) => {
        if (case_id) router.push(`/app/case/${case_id}/dashboard`)
      })
      .catch((err) => {
        persistPendingNarrative(pending)
        console.error("bootstrap failed", err)
      })
  }, [isSignedIn, router])

  return null
}

