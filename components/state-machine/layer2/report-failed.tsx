'use client'

/**
 * Layer 2 node `L2-ReportFailed` (SM Diagram 3).
 *
 * Reached when either:
 *   - `jobs.status = 'failed'` for this case's `post_payment_report_generation`
 *     job (the background worker gave up after 3 retries), or
 *   - the 120s safety timer fires without a Realtime row arriving.
 *
 * Copy reassures the user their payment is safe and offers a direct
 * support path. A manual "Retry" button is optional — Slice 6's background
 * worker already retries 3x, so exposing a retry here is more about user
 * comfort than actual recovery.
 */

import { ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export interface ReportFailedProps {
  errorMessage?: string | null
  onContactSupport?: () => void
  onRetry?: () => void
}

export function ReportFailed({ errorMessage, onContactSupport, onRetry }: ReportFailedProps) {
  return (
    <Card className="mx-auto max-w-lg border-destructive/30 bg-destructive/5">
      <CardHeader className="flex flex-row items-start gap-3">
        <div className="mt-1 rounded-full bg-destructive/10 p-2 text-destructive">
          <ShieldAlert className="h-6 w-6" aria-hidden />
        </div>
        <div className="flex-1">
          <CardTitle>We hit a snag generating your report</CardTitle>
          <CardDescription>
            Your payment is safe — we&apos;ve been alerted and someone will reach out within one
            business day. You can also contact support now.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {errorMessage ? (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground">Technical details</summary>
            <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 font-mono text-[11px]">
              {errorMessage}
            </pre>
          </details>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          {onContactSupport ? (
            <Button onClick={onContactSupport} className="flex-1">
              Contact support
            </Button>
          ) : null}
          {onRetry ? (
            <Button variant="outline" onClick={onRetry} className="flex-1">
              Retry report generation
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
