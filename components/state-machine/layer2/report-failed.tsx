'use client'

/**
 * Layer 2 node `L2-ReportFailed` (SM Diagram 3).
 *
 * Reached when the report job returns a failed status. Optional recovery
 * actions are supplied by the state-machine driver.
 */

import { ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export interface ReportFailedProps {
  errorMessage?: string | null
  onContactSupport?: () => void
  onRetry?: () => void
}

export function ReportFailed({ onContactSupport, onRetry }: ReportFailedProps) {
  return (
    <Card className="mx-auto max-w-lg border-destructive/30 bg-destructive/5">
      <CardHeader className="flex flex-row items-start gap-3">
        <div className="mt-1 rounded-full bg-destructive/10 p-2 text-destructive">
          <ShieldAlert className="h-6 w-6" aria-hidden />
        </div>
        <div className="flex-1">
          <CardTitle>We hit a snag generating your report</CardTitle>
          <CardDescription>
            The report could not be completed. Your case remains available while you decide what to do next.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground" role="status">
          Try again later or use the support option if it is available.
        </p>

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
