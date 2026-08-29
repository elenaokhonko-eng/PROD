"use client"

const STORAGE_KEY = "gb_pending_narrative"

export type PendingNarrativePayload = {
  narrative: string
  transcript?: string
}

export function persistPendingNarrative(payload: PendingNarrativePayload) {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // The capture remains in component state when browser storage is unavailable.
  }
}

export function readPendingNarrative(): PendingNarrativePayload | null {
  if (typeof window === "undefined") return null

  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingNarrativePayload
    return typeof parsed.narrative === "string" && parsed.narrative.trim() ? parsed : null
  } catch {
    return null
  }
}

export function clearPendingNarrative() {
  if (typeof window === "undefined") return
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing else is required when storage is unavailable.
  }
}

