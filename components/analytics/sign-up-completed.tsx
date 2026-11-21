'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ANALYTICS_SIGN_UP_EVENT, SIGN_UP_COMPLETED_EVENT } from '@/lib/analytics/google-tag'

// Reports the sign-up conversion to Google Tag Manager and continues. The event carries no personal data. Google
// confirms through eventCallback; after two seconds the person continues regardless (blocked scripts, slow network).
export function SignUpCompleted({ next, report }: { next: string; report: boolean }) {
  const router = useRouter()
  useEffect(() => {
    let done = false
    const go = () => {
      if (done) return
      done = true
      router.replace(next)
    }
    if (!report) {
      go()
      return
    }
    const w = window as unknown as { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void }
    w.dataLayer = w.dataLayer || []
    w.dataLayer.push({ event: SIGN_UP_COMPLETED_EVENT, eventCallback: go, eventTimeout: 2000 })
    // Google Analytics' standard sign-up event, through the Google tag when it has loaded.
    w.gtag?.('event', ANALYTICS_SIGN_UP_EVENT, { method: 'email or Google' })
    const fallback = window.setTimeout(go, 2500)
    return () => window.clearTimeout(fallback)
  }, [next, report, router])
  return null
}
