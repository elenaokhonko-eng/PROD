'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, RotateCcw } from 'lucide-react'
import { clearPendingNarrative } from '@/components/landing/hero-capture'
import { NarrativeCapture } from '@/components/landing/narrative-capture'
import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import {
  clearSessionToken,
  createRouterSession,
  getRouterSession,
  getSessionToken,
  replaceRouterSessionIfCurrent,
  rotateRouterSessionIntent,
} from '@/lib/router-session'

type CatchUpState =
  | { type: 'none' }
  | { type: 'has_results'; summary: string }
  | { type: 'has_narrative'; narrative: string; summary: string }

export default function RouterPage() {
  const [catchUp, setCatchUp] = useState<CatchUpState>({ type: 'none' })
  const [initialNarrative, setInitialNarrative] = useState('')
  const [captureKey, setCaptureKey] = useState(0)
  const [sessionError, setSessionError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const initialize = async () => {
      try {
        const existingToken = getSessionToken()
        if (!existingToken) {
          await createRouterSession()
          return
        }
        const session = await getRouterSession(existingToken)
        if (!session || (session.expires_at && new Date(session.expires_at) < new Date())) {
          await replaceRouterSessionIfCurrent(existingToken)
          return
        }
        if (cancelled) return
        const classification = session.classification_result as Record<string, unknown> | null | undefined
        const savedNarrative = session.dispute_narrative
        if (classification && typeof classification.summary === 'string') {
          setCatchUp({ type: 'has_results', summary: classification.summary })
        } else if (savedNarrative) {
          setCatchUp({
            type: 'has_narrative',
            narrative: savedNarrative,
            summary: savedNarrative.length > 80 ? `${savedNarrative.slice(0, 80)}…` : savedNarrative,
          })
        }
      } catch {
        if (!cancelled) setSessionError('The complaint check could not start. Check your connection and try again.')
      }
    }
    void initialize()
    return () => {
      cancelled = true
    }
  }, [])

  const startFresh = async () => {
    setSessionError(null)
    clearSessionToken()
    rotateRouterSessionIntent()
    clearPendingNarrative()
    setCatchUp({ type: 'none' })
    setInitialNarrative('')
    setCaptureKey((key) => key + 1)
    try {
      await createRouterSession()
    } catch {
      setSessionError('A new complaint check could not be started. Check your connection and try again.')
    }
  }

  const continueNarrative = (narrative: string) => {
    setInitialNarrative(narrative)
    setCatchUp({ type: 'none' })
    setCaptureKey((key) => key + 1)
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader badge="Free complaint path" />
      <main id="main-content" className="hero-gradient min-h-[calc(100vh-4rem)] py-10 sm:py-16">
        <div className="gb-container max-w-3xl">
          <div className="mb-8 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">Complaint path</p>
            <h1 className="mt-3 text-4xl font-semibold text-harbor-deep sm:text-5xl">Tell Lumi what happened.</h1>
            <p className="mx-auto mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">Share the situation in your own words. Lumi will organise the information and help identify a possible next route.</p>
          </div>

          {sessionError && <div role="alert" className="mb-4 rounded-xl border border-destructive/40 bg-harbor-error-tint p-4">{sessionError}</div>}

          {catchUp.type !== 'none' && (
            <section className="mb-4 rounded-2xl border border-primary/30 bg-card p-5" aria-labelledby="resume-title">
              <h2 id="resume-title" className="font-semibold">Welcome back — your progress is saved</h2>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">“{catchUp.summary}”</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {catchUp.type === 'has_results' ? (
                  <Button asChild size="sm"><Link href="/router/results">Continue to results <ArrowRight aria-hidden="true" /></Link></Button>
                ) : (
                  <Button size="sm" onClick={() => continueNarrative(catchUp.narrative)}>Continue your story <ArrowRight aria-hidden="true" /></Button>
                )}
                <Button variant="outline" size="sm" onClick={() => void startFresh()}><RotateCcw aria-hidden="true" /> Start fresh</Button>
              </div>
            </section>
          )}

          <NarrativeCapture key={captureKey} initialNarrative={initialNarrative} />
        </div>
      </main>
    </div>
  )
}
