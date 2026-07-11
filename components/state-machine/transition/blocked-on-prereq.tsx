'use client'

/**
 * Transition node `T-BlockedOnPrereq` (SM Diagram 2).
 *
 * Nudge card rendered when `get_case_eligibility.eligible_actions.run_report_selfserve`
 * is `false`. Copy is driven by `missing` (derived by the driver from the
 * `prerequisites` object). Clicking "Retry" asks the parent to re-fetch
 * eligibility (IS §6 is idempotent and cheap).
 */

import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export interface BlockedOnPrereqProps {
  /** Ordered list of missing prerequisites. The first one drives the
   *  headline nudge; the rest are shown as secondary bullets. */
  missing: string[]
  /** Optional override for the generic blocked reason. */
  reason?: string
  onRetry?: () => void
}

const COPY: Record<string, { title: string; detail: string }> = {
  extract: {
    title: 'Finish your intake first',
    detail: 'Submit your case narrative so we can analyse it.',
  },
  validation: {
    title: 'Answer the gap questions',
    detail: 'A few more details will unlock the paid report.',
  },
  documents: {
    title: 'Add at least one supporting document',
    detail: 'Upload a bank statement, screenshot, or email so the report can cite real evidence.',
  },
  decision: {
    title: 'Decision not ready yet',
    detail: "We're still analysing your case. This usually takes less than a minute.",
  },
}

export function BlockedOnPrereq({ missing, reason, onRetry }: BlockedOnPrereqProps) {
  const primaryKey = missing[0]
  const primary = primaryKey ? COPY[primaryKey] : null

  return (
    <Card className="border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20">
      <CardHeader className="flex flex-row items-start gap-3">
        <div className="mt-1 rounded-md bg-amber-100 p-2 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
          <AlertTriangle className="h-5 w-5" aria-hidden />
        </div>
        <div className="flex-1">
          <CardTitle>{primary?.title ?? 'Not quite ready yet'}</CardTitle>
          <CardDescription>{reason ?? primary?.detail ?? 'A prerequisite is missing.'}</CardDescription>
        </div>
      </CardHeader>
      {missing.length > 1 || onRetry ? (
        <CardContent className="space-y-3">
          {missing.length > 1 ? (
            <ul className="ml-4 list-disc space-y-1 text-sm text-muted-foreground">
              {missing.slice(1).map((key) => (
                <li key={key}>{COPY[key]?.detail ?? key}</li>
              ))}
            </ul>
          ) : null}
          {onRetry ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              I&apos;ve done that — check again
            </Button>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  )
}
