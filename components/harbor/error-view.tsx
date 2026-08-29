'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

type ErrorViewProps = {
  title?: string
  description?: string
  reset: () => void
  homeHref?: string
  homeLabel?: string
}

export function ErrorView({
  title = 'Something went wrong',
  description = 'This page could not be loaded. Retry, or return to a known page.',
  reset,
  homeHref = '/',
  homeLabel = 'Return home',
}: ErrorViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <main id="main-content" className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <section className="gb-card w-full max-w-xl p-8 text-center" role="alert" aria-labelledby="error-title">
        <AlertCircle className="mx-auto size-10 text-destructive" aria-hidden="true" />
        <h1 ref={headingRef} id="error-title" tabIndex={-1} className="mt-5 text-3xl font-semibold text-harbor-deep outline-none">
          {title}
        </h1>
        <p className="mx-auto mt-3 max-w-md leading-7 text-muted-foreground">{description}</p>
        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          <Button type="button" className="min-h-11" onClick={reset}>Retry</Button>
          <Button asChild variant="outline" className="min-h-11">
            <Link href={homeHref}>{homeLabel}</Link>
          </Button>
        </div>
      </section>
    </main>
  )
}
