// Analytics 2 (brief W1 §N): the journey steps before and around sign-up. Each browser tab gets a random number kept in
// sessionStorage (gone when the tab closes); no cookies, no IP address, no user agent, no story text. The channel the
// visitor first arrived from is kept for the tab, so later steps keep it after moving between pages.

export const FUNNEL_EVENTS = ['home_viewed', 'story_started', 'story_submitted', 'signup_reached', 'case_created'] as const
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number]
export const DEVICE_CLASSES = ['phone', 'tablet', 'desktop'] as const
export type DeviceClass = (typeof DEVICE_CLASSES)[number]

export type FirstTouch = {
  referrer_host: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  device_class: DeviceClass
}

const ID_KEY = 'gb-funnel-id'
const TOUCH_KEY = 'gb-funnel-touch'
const SENT_PREFIX = 'gb-funnel-sent:'
export const FUNNEL_ENDPOINT = '/api/funnel'

export function deviceClass(width: number): DeviceClass {
  if (width < 640) return 'phone'
  if (width < 1024) return 'tablet'
  return 'desktop'
}

const clip = (value: string | null, max: number) => (value ? value.trim().slice(0, max) || null : null)

/** The channel for a landing: another site's host name (never its path) and the UTM tags of the landing address. */
export function firstTouchFrom(landing: { href: string; referrer: string; width: number }): FirstTouch {
  const url = new URL(landing.href)
  let referrerHost: string | null = null
  try {
    const host = landing.referrer ? new URL(landing.referrer).hostname : ''
    referrerHost = host && host !== url.hostname ? host : null
  } catch {
    referrerHost = null
  }
  return {
    referrer_host: clip(referrerHost, 200),
    utm_source: clip(url.searchParams.get('utm_source'), 100),
    utm_medium: clip(url.searchParams.get('utm_medium'), 100),
    utm_campaign: clip(url.searchParams.get('utm_campaign'), 100),
    device_class: deviceClass(landing.width),
  }
}

function tabStorage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function tabId(storage: Storage | null): string {
  const existing = storage?.getItem(ID_KEY)
  if (existing) return existing
  const id = crypto.randomUUID()
  storage?.setItem(ID_KEY, id)
  return id
}

/** The tab's first touch, recorded the first time this runs in the tab. */
export function rememberFirstTouch(): FirstTouch | null {
  if (typeof window === 'undefined') return null
  const storage = tabStorage()
  try {
    const saved = storage?.getItem(TOUCH_KEY)
    if (saved) return JSON.parse(saved) as FirstTouch
  } catch {
    // A damaged entry is replaced below.
  }
  const touch = firstTouchFrom({ href: window.location.href, referrer: document.referrer, width: window.innerWidth })
  storage?.setItem(TOUCH_KEY, JSON.stringify(touch))
  return touch
}

/** The tab's first touch if one was recorded, without recording one. */
export function savedFirstTouch(): FirstTouch | null {
  try {
    const saved = tabStorage()?.getItem(TOUCH_KEY)
    return saved ? (JSON.parse(saved) as FirstTouch) : null
  } catch {
    return null
  }
}

/** Records a step once per tab. Never throws and never delays the page. */
export function trackFunnel(event: FunnelEvent): void {
  if (typeof window === 'undefined') return
  try {
    const storage = tabStorage()
    if (storage?.getItem(SENT_PREFIX + event)) return
    storage?.setItem(SENT_PREFIX + event, '1')
    const body = JSON.stringify({ event, anon_session_id: tabId(storage), path: window.location.pathname.slice(0, 200), ...rememberFirstTouch() })
    // keepalive lets the step finish after the page moves on (story submitted → sign-up).
    void fetch(FUNNEL_ENDPOINT, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {})
  } catch {
    // Analytics never gets in the visitor's way.
  }
}
