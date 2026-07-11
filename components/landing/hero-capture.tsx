"use client"

const STORAGE_KEY = "gb_pending_narrative"

type PendingNarrativePayload = {
  narrative: string
  transcript?: string
}

export function persistPendingNarrative(payload: PendingNarrativePayload) {
  if (typeof window === "undefined") return
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))

  // Best-effort mirror for Clerk session continuity.
  const clerk = (window as typeof window & { Clerk?: any }).Clerk
  if (!clerk?.user) return

  void clerk.user
    .update({
      unsafeMetadata: {
        ...(clerk.user.unsafeMetadata ?? {}),
        pending_narrative: payload,
      },
    })
    .catch(() => {})
}

export function readAndClearPendingNarrative(): PendingNarrativePayload | null {
  if (typeof window === "undefined") return null

  const raw = sessionStorage.getItem(STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as PendingNarrativePayload
    sessionStorage.removeItem(STORAGE_KEY)
    return parsed
  } catch {
    sessionStorage.removeItem(STORAGE_KEY)
    return null
  }
}

