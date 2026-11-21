import Script from 'next/script'
import { GOOGLE_TAG_ID, GOOGLE_TAG_MANAGER_ID, googleTagEnabled, googleTagManagerSnippet, googleTagSnippet } from '@/lib/analytics/google-tag'

// Google Tag Manager and the Google tag for Analytics on a public page (lib/analytics/google-tag.ts). Renders nothing
// outside production.
export function GoogleTagManager() {
  if (!googleTagEnabled()) return null
  return (
    <>
      <Script id="google-tag-manager" strategy="afterInteractive">
        {googleTagManagerSnippet()}
      </Script>
      <Script id="google-tag-js" src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_TAG_ID}`} strategy="afterInteractive" />
      <Script id="google-tag" strategy="afterInteractive">
        {googleTagSnippet()}
      </Script>
      <noscript>
        <iframe
          src={`https://www.googletagmanager.com/ns.html?id=${GOOGLE_TAG_MANAGER_ID}`}
          height="0"
          width="0"
          style={{ display: 'none', visibility: 'hidden' }}
          title="Google Tag Manager"
        />
      </noscript>
    </>
  )
}
