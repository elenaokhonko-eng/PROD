// Google Tag Manager for the public site (Elena, 20 Nov 2026: Google campaign tracking). Loaded on the public marketing
// pages and the sign-up page only, never in the signed-in case area, and only in production, so staging visits don't
// reach the campaign data.

export const GOOGLE_TAG_MANAGER_ID = 'GTM-WD9X2LV2'

export function googleTagEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.HARBOR_DEPLOYMENT_ENVIRONMENT?.trim() === 'production'
}

// Google's standard container snippet: it records the page-load event (gtm.start) that "All pages" triggers fire on,
// then loads the container.
export function googleTagManagerSnippet(id: string = GOOGLE_TAG_MANAGER_ID): string {
  return `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${id}');`
}

// The sign-up conversion (Elena, 20 Nov 2026): Clerk sends a new account to /signed-up, a public step outside the
// case area, which reports this one event to Google and then continues to where the person was going.
export const SIGN_UP_COMPLETED_EVENT = 'sign_up_completed'
export const SIGNED_UP_PATH = '/signed-up'

/** Only a path on this site, never another origin ("//evil.example", "https://…", backslashes). */
export function safeNextPath(value: unknown, fallback = '/app'): string {
  if (typeof value !== 'string') return fallback
  const path = value.trim()
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') &&!/[\u0000-\u001f]/.test(path) ? path : fallback
}

export function signedUpRedirect(redirectUrl: unknown): string {
  return `${SIGNED_UP_PATH}?next=${encodeURIComponent(safeNextPath(redirectUrl))}`
}
