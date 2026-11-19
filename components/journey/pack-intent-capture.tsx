'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { parsePackIntent, savePackIntent } from '@/lib/journey/pack-intent'

// On the sign-in and sign-up pages: remembers `?intent=bank|fidrec` for the dashboard. Renders nothing.
export function PackIntentCapture() {
  const searchParams = useSearchParams()
  const intent = parsePackIntent(searchParams.get('intent'))
  useEffect(() => {
    if (intent) savePackIntent(intent)
  }, [intent])
  return null
}
