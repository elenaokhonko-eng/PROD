'use client'

/**
 * Layer 2 node `L2-ReportDrafting` (SM Diagram 3).
 *
 * Progress screen while the background worker is running
 * `run_report_selfserve_v1`. Transitions to `L2-ReportReady` when a
 * `reports` row with `status='COMPLETED'` lands via Realtime.
 */

import { useEffect, useState } from 'react'
import { BookOpen, FileText, ListChecks, type LucideIcon } from 'lucide-react'
import { StateMachineLoading } from '@/components/state-machine/loading-state'
import { Card, CardContent } from '@/components/ui/card'
import type { DecisionJson } from '@/lib/types/decision'
import { cn } from '@/lib/utils'

const STEPS: Array<{ icon: LucideIcon; label: string }> = [
  { icon: BookOpen, label: 'Drafting the executive summary' },
  { icon: ListChecks, label: 'Assembling your evidence checklist' },
  { icon: FileText, label: 'Writing the requested resolution' },
]

export interface ReportDraftingProps {
  /** Optional — show a soft "this is taking longer than usual" warning
   *  after N seconds. Defaults 60s. */
  slowWarningAfterMs?: number
  /** When present, we show a two-line "Decision ready" preview above the
   *  drafting spinner so users know Stage 1 succeeded. */
  decisionPreview?: DecisionJson | null
}

export function ReportDrafting({
  slowWarningAfterMs = 60_000,
  decisionPreview,
}: ReportDraftingProps) {
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
        {decisionPreview?.eligibility ? (
          <div className="rounded-md border border-primary/30 bg-[var(--gb-tint-teal)] p-3 text-sm">
            <p className="font-medium">Decision ready</p>
            <p className="text-muted-foreground">
              Status: <span className="font-medium">{decisionPreview.eligibility.status}</span>
              {typeof decisionPreview.eligibility.score === 'number' ? (
                <>
                  {' '}
                  · Score: <span className="font-medium">{decisionPreview.eligibility.score}</span>
                </>
              ) : null}
            </p>
          </div>
        ) : null}

        <StateMachineLoading
          size="full"
          title="Drafting your complaint report"
          description="Up to 30 seconds — almost there."
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
            Taking a bit longer than usual. Your payment is safe — we&apos;re still working.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
