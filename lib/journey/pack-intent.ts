// The pack a person chose before signing in (`/sign-in?intent=bank`, lib/harbor/packs.ts packHref). Kept in the
// browser for a day so it survives sign-up and writing the story; the dashboard then offers that pack straight away
// (stage2-plan milestone 4: people arrive at any point in their dispute). Not sensitive: only "bank" or "fidrec".

export type PackIntent = 'bank' | 'fidrec'

const KEY = 'guidebuoy.packIntent'
const TTL_MS = 24 * 60 * 60 * 1000

export function parsePackIntent(value: string | null | undefined): PackIntent | null {
  return value === 'bank' || value === 'fidrec' ? value : null
}

export function savePackIntent(intent: PackIntent, now = Date.now()) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ intent, at: now }))
  } catch {
    // Storage blocked (private mode): the person simply sees the usual path.
  }
}

export function readPackIntent(now = Date.now()): PackIntent | null {
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as { intent?: string; at?: number } | null
    if (!stored || typeof stored.at !== 'number' || now - stored.at > TTL_MS) return null
    return parsePackIntent(stored.intent)
  } catch {
    return null
  }
}

export function clearPackIntent() {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // Nothing to clear.
  }
}
