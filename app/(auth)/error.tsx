'use client'

import { useEffect } from 'react'
import { ErrorView } from '@/components/harbor/error-view'

export default function AuthenticationError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[auth-error] Authentication page rendering failed', error)
  }, [error])

  return (
    <ErrorView
      title="Sign-in page unavailable"
      description="The authentication page could not be loaded. Retry, or return home."
      reset={reset}
    />
  )
}
