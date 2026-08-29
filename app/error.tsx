'use client'

import { useEffect } from 'react'
import { ErrorView } from '@/components/harbor/error-view'

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[root-error] Page rendering failed', error)
  }, [error])

  return <ErrorView reset={reset} />
}
