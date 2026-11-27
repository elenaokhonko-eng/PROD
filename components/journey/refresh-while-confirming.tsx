'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Stripe can send the person back before the purchase is recorded: the list is read again for about a minute.
export function RefreshWhileConfirming() {
  const router = useRouter()
  useEffect(() => {
    let times = 0
    const timer = setInterval(() => {
      if (++times >= 20) clearInterval(timer)
      router.refresh()
    }, 3000)
    return () => clearInterval(timer)
  }, [router])
  return null
}
