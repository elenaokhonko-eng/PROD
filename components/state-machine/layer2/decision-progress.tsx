'use client'

/**
 * Layer 2 node `L2-DecisionRunning` (SM Diagram 3).
 *
 * Animated "Analysing your case..." progress screen while the background
 * worker is running `run_case_decision_v1`. Transitions to
 * `L2-ReportDrafting` when a `case_decision_runs` row lands via Realtime.
 *
 * The spinner is ambient; the real progress signal is Realtime, not a
 * client-side timer.
 */

import { useEffect, useState } from 'react'
import { BarChart3, FileSearch, Scale, type LucideIcon } from 'lucide-react'
import { StateMachineLoading } from '@/components/state-machine/loading-state'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/** The three stepping-stones shown beneath the spinner. They're purely
 *  cosmetic — Realtime is the source of truth for the actual transition. */
const STEPS: Array<{ icon: LucideIcon; label: string }> = [
  { icon: FileSearch, label: 'Reading your intake and evidence' },
  { icon: Scale, label: 'Mapping to Singapore regulations and SRF' },
  { icon: BarChart3, label: 'Computing your case strength score' },
]

export interface DecisionProgressProps {
  /** Optional — show a soft "this is taking longer than usual" warning
   *  after N seconds. Defaults 60s. */
  slowWarningAfterMs?: number
}

export function DecisionProgress({ slowWarningAfterMs = 60_000 }: DecisionProgressProps) {
  const [activeStep, setActiveStep] = useState(0)
  const [showSlowWarning, setShowSlowWarning] = useState(false)

  useEffect(() => {
    const tick = setInterval(() => {
      setActiveStep((i) => (i + 1) % STEPS.length)
    }, 2500)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setShowSlowWarning(true), slowWarningAfterMs)
    return () => clearTimeout(t)
  }, [slowWarningAfterMs])

  return (
    <Card className="mx-auto max-w-lg">
      <CardContent className="space-y-6 p-6">
        <StateMachineLoading
          size="full"
          title="Analysing your case"
          description="Against Singapore regulations and prior decisions — usually under a minute."
          className="min-h-0"
        />
        <ul className="space-y-2">
          {STEPS.map((step, i) => {
            const Icon = step.icon
            const isActive = i === activeStep
            return (
              <li
                key={step.label}
                className={cn(
                  'flex items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'border-primary/40 bg-primary/5 text-foreground'
                    : 'border-transparent text-muted-foreground',
                )}
              >
                <Icon
                  className={cn('h-4 w-4', isActive ? 'text-primary' : 'text-muted-foreground')}
                  aria-hidden
                />
                <span>{step.label}</span>
              </li>
            )
          })}
        </ul>
        {showSlowWarning ? (
          <p className="text-xs text-muted-foreground" role="status">
            This is taking a bit longer than usual — your payment is safe, we&apos;ll keep trying.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
