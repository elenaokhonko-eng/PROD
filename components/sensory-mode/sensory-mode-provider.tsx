"use client"

import { useUser } from "@clerk/nextjs"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"

export const SENSORY_STORAGE_KEY = "gb-sensory-mode"
export const SENSORY_MODES = ["steady", "quiet", "grounding"] as const

export type SensoryMode = (typeof SENSORY_MODES)[number]

type SensoryModeContextValue = {
  mode: SensoryMode
  setMode: (mode: SensoryMode) => void
  resumeFromGrounding: () => void
}

const SensoryModeContext = createContext<SensoryModeContextValue | null>(null)

function isSensoryMode(value: unknown): value is SensoryMode {
  return typeof value === "string" && SENSORY_MODES.includes(value as SensoryMode)
}

function readDeviceMode(): SensoryMode {
  if (typeof window === "undefined") return "steady"
  const stored = window.localStorage.getItem(SENSORY_STORAGE_KEY)
  return isSensoryMode(stored) ? stored : "steady"
}

function applyMode(mode: SensoryMode) {
  document.documentElement.dataset.sensory = mode
  window.localStorage.setItem(SENSORY_STORAGE_KEY, mode)
  window.dispatchEvent(new CustomEvent("gb:sensory-mode", { detail: mode }))
}

export function SensoryModeProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useUser()
  const [mode, setModeState] = useState<SensoryMode>("steady")
  const previousModeRef = useRef<SensoryMode>("steady")

  const setMode = useCallback(
    (nextMode: SensoryMode) => {
      if (nextMode === "grounding" && mode !== "grounding") previousModeRef.current = mode
      if (nextMode !== "grounding") previousModeRef.current = nextMode
      setModeState(nextMode)
      applyMode(nextMode)

      if (isSignedIn) {
        void fetch("/api/preferences/sensory-mode", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: nextMode }),
        })
      }
    },
    [isSignedIn, mode],
  )

  const resumeFromGrounding = useCallback(() => {
    setMode(previousModeRef.current)
  }, [setMode])

  useEffect(() => {
    const deviceMode = readDeviceMode()
    if (deviceMode !== "grounding") previousModeRef.current = deviceMode
    setModeState(deviceMode)
    applyMode(deviceMode)
  }, [])

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return

    const controller = new AbortController()
    void fetch("/api/preferences/sensory-mode", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null
        return (await response.json()) as { mode?: unknown }
      })
      .then((payload) => {
        if (payload && isSensoryMode(payload.mode)) {
          if (payload.mode !== "grounding") previousModeRef.current = payload.mode
          setModeState(payload.mode)
          applyMode(payload.mode)
        }
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("Unable to hydrate sensory preference; using this device's setting.")
        }
      })

    return () => controller.abort()
  }, [isLoaded, isSignedIn])

  const value = useMemo(() => ({ mode, setMode, resumeFromGrounding }), [mode, resumeFromGrounding, setMode])
  return <SensoryModeContext.Provider value={value}>{children}</SensoryModeContext.Provider>
}

export function useSensoryMode() {
  const context = useContext(SensoryModeContext)
  if (!context) throw new Error("useSensoryMode must be used within SensoryModeProvider")
  return context
}
