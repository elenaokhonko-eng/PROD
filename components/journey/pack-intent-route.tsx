'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { readPackIntent } from '@/lib/journey/pack-intent'

const ROUTED_KEY = 'guidebuoy.packIntentRouted'

// PB-18 (Part B walk-through, 25 Nov): a signed-in person who chose a pack on /pricing came back to the case list (or the
// story box) instead of the case the pack is for. With a pack just chosen, the case list opens the latest case once per
// tab, where the pack is offered; afterwards the list works as before.
export function PackIntentRoute({ caseId }: { caseId: string | null }) {
  const router = useRouter()
  useEffect(() => {
    if (!caseId || !readPackIntent()) return
    try {
      if (window.sessionStorage.getItem(ROUTED_KEY)) return
      window.sessionStorage.setItem(ROUTED_KEY, '1')
    } catch {
      return
    }
    router.replace(`/app/case/${caseId}/dashboard`)
  }, [caseId, router])
  return null
}
