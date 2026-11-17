'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'

// Brief W1 §D1 and Addendum V §V2: the emergency strip at the top of the home page, on the warning tint. Not sticky.
// Dismissing it hides it for the rest of the visit (this tab only); the server always renders it, so it shows without
// JavaScript.
const DISMISSED_KEY = 'gb-emergency-strip-dismissed'

export function EmergencyStrip() {
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISSED_KEY) === '1') setDismissed(true)
    } catch {
      // Storage can be blocked; the strip then simply shows again on the next page load.
    }
  }, [])

  if (dismissed) return null

  const dismiss = () => {
    setDismissed(true)
    try {
      sessionStorage.setItem(DISMISSED_KEY, '1')
    } catch {}
  }

  return (
    <aside aria-label="Scam happening now?" className="bg-harbor-warning-tint" data-testid="emergency-strip">
      <div className="gb-container flex items-start gap-3 py-3">
        <p className="flex-1 py-1.5 text-base leading-7 text-foreground">
          Scam happening now? Call your bank&apos;s fraud hotline first, then ScamShield on{' '}
          <a href="tel:1799" className="font-semibold underline">1799</a>. Come back when your accounts are safe.{' '}
          <Link href="/resources" className="font-medium underline">What to do in the first 24 hours</Link>
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-foreground outline-none hover:bg-background/60 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
    </aside>
  )
}
