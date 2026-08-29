'use client'

import { useEffect } from 'react'
import { ErrorView } from '@/components/harbor/error-view'

export default function CaseError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[case-error] Case page rendering failed', error)
  }, [error])

  return (
    <ErrorView
      title="Case workspace unavailable"
      description="The workspace could not be loaded. Retry, or return to the case list."
      reset={reset}
      homeHref="/app"
      homeLabel="Return to cases"
    />
  )
}
