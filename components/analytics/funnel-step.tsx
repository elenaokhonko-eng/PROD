'use client'

import { useEffect } from 'react'
import { type FunnelEvent, rememberFirstTouch, trackFunnel } from '@/lib/analytics/funnel'

// Analytics 2: records the tab's first touch on any public page, and a journey step when a page is reached.
export function FunnelStep({ event }: { event?: FunnelEvent }) {
  useEffect(() => {
    rememberFirstTouch()
    if (event) trackFunnel(event)
  }, [event])
  return null
}
