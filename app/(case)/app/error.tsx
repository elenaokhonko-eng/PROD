'use client'

import { useEffect } from 'react'
import { ErrorView } from '@/components/harbor/error-view'

export default function CasesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[cases-error] Case list rendering failed', error)
  }, [error])

  return (
    <ErrorView
      title="Your cases could not be loaded"
      description="The case service may be unavailable. Retry without leaving this page, or return home."
      reset={reset}
      homeHref="/"
      homeLabel="Return home"
    />
  )
}
