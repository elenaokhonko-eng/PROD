"use client"

import { useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { useSensoryMode } from "./sensory-mode-provider"

export function GroundingOverlay() {
  const { mode, resumeFromGrounding } = useSensoryMode()
  const continueRef = useRef<HTMLButtonElement>(null)
  const isOpen = mode === "grounding"

  useEffect(() => {
    if (!isOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    continueRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="gb-grounding-title"
      className="fixed inset-0 z-[100] flex min-h-dvh items-center justify-center bg-background px-6"
    >
      <div className="flex max-w-md flex-col items-center text-center">
        <div className="gb-grounding-breath mb-10 h-40 w-40 rounded-full" aria-hidden="true" />
        <h1 id="gb-grounding-title" className="text-2xl font-semibold text-foreground">
          Take the time you need.
        </h1>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          Your place is safe. Breathe in, hold, and breathe out when it feels comfortable.
        </p>
        <Button ref={continueRef} className="mt-8 min-h-12 px-6" onClick={resumeFromGrounding}>
          Continue when ready
        </Button>
      </div>
    </div>
  )
}
