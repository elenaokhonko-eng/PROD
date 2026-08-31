'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2, Loader2, RotateCcw } from 'lucide-react'
import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import { getRouterSession, getSessionToken, updateRouterSession } from '@/lib/router-session'

type ClassificationPhase = 'loading' | 'slow' | 'complete' | 'error'

const SLOW_CLASSIFICATION_MS = 8_000
const COMPLETE_REDIRECT_MS = 700

export default function ClassifyPage() {
  const [phase, setPhase] = useState<ClassificationPhase>('loading')
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    let redirectTimer: number | undefined
    const controller = new AbortController()
    const slowTimer = window.setTimeout(() => {
      if (!cancelled) setPhase('slow')
    }, SLOW_CLASSIFICATION_MS)

    const continueToQuestions = () => {
      if (cancelled) return
      window.clearTimeout(slowTimer)
      setPhase('complete')
      redirectTimer = window.setTimeout(() => {
        router.replace('/router/questions')
      }, COMPLETE_REDIRECT_MS)
    }

    const analyzeDispute = async () => {
      setError(null)
      setPhase('loading')

      try {
        const sessionToken = getSessionToken()
        if (!sessionToken) {
          router.replace('/router')
          return
        }

        const session = await getRouterSession(sessionToken)
        if (cancelled) return
        if (!session?.dispute_narrative) {
          router.replace('/router')
          return
        }

        if (session.classification_result) {
          continueToQuestions()
          return
        }

        const response = await fetch('/api/router/classify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_token: sessionToken,
            narrative: session.dispute_narrative,
          }),
          signal: controller.signal,
        })

        if (!response.ok) throw new Error('Classification failed')

        const classification = (await response.json()) as Record<string, unknown>
        const savedSession = await updateRouterSession(sessionToken, {
          classification_result: classification,
          user_responses: {},
        })
        if (!savedSession) throw new Error('Classification could not be saved')

        continueToQuestions()
      } catch (classificationError) {
        if (cancelled || (classificationError instanceof DOMException && classificationError.name === 'AbortError')) return
        console.error('[v0] Error analyzing incident:', classificationError)
        window.clearTimeout(slowTimer)
        setError('Something went wrong. Please try again.')
        setPhase('error')
      }
    }

    void analyzeDispute()

    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(slowTimer)
      if (redirectTimer) window.clearTimeout(redirectTimer)
    }
  }, [attempt, router])

  useEffect(() => {
    if (phase === 'error') errorRef.current?.focus()
  }, [phase])

  const retry = () => setAttempt((current) => current + 1)
  const isWorking = phase === 'loading' || phase === 'slow'

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader badge="Free complaint path" />
      <main id="main-content" className="hero-gradient min-h-[calc(100vh-4rem)] py-10 sm:py-16">
        <div className="gb-container max-w-2xl">
          <p className="text-center text-sm font-semibold uppercase tracking-[0.14em] text-primary">Complaint path · Step 2</p>
          <section
            className="gb-card mt-4 p-6 sm:p-8"
            aria-labelledby="classification-title"
            aria-busy={isWorking}
          >
            {phase === 'error' ? (
              <div ref={errorRef} role="alert" tabIndex={-1} className="text-center outline-none">
                <AlertCircle className="mx-auto size-11 text-destructive" aria-hidden="true" />
                <h1 id="classification-title" className="mt-4 text-2xl font-semibold text-harbor-deep sm:text-3xl">
                  We couldn’t check your complaint path
                </h1>
                <p className="mx-auto mt-3 max-w-lg leading-7 text-muted-foreground">
                  {error} Your story is still saved for this complaint check.
                </p>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
                  <Button onClick={retry}>
                    <RotateCcw aria-hidden="true" /> Retry
                  </Button>
                  <Button asChild variant="outline">
                    <Link href="/router">Return to your story</Link>
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-center" role="status" aria-live="polite">
                {phase === 'complete' ? (
                  <CheckCircle2 className="mx-auto size-11 text-primary" aria-hidden="true" />
                ) : (
                  <Loader2 className="mx-auto size-11 animate-spin text-primary" aria-hidden="true" />
                )}
                <h1 id="classification-title" className="mt-4 text-2xl font-semibold text-harbor-deep sm:text-3xl">
                  {phase === 'complete' ? 'Your next questions are ready' : 'Lumi is organising what you shared'}
                </h1>
                <p className="mx-auto mt-3 max-w-lg leading-7 text-muted-foreground">
                  {phase === 'slow'
                    ? 'This is taking longer than usual. Your story is still saved, and the check is continuing.'
                    : phase === 'complete'
                      ? 'Opening a few focused questions before showing your result.'
                      : 'This usually takes a moment. No decision is being made about your case.'}
                </p>
                {isWorking && (
                  <ol className="mx-auto mt-7 grid max-w-lg gap-3 text-left" aria-label="Classification stages">
                    {['Reading your story', 'Identifying the complaint type', 'Preparing focused questions'].map((stage, index) => (
                      <li key={stage} className="flex items-center gap-3 rounded-xl border bg-background/70 px-4 py-3 text-sm">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-harbor-sage-tint font-semibold text-primary">
                          {index + 1}
                        </span>
                        <span>{stage}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}
