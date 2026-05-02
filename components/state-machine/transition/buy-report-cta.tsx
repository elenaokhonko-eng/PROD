'use client'

/**
 * Transition node `T-BuyReportCTA` (SM Diagram 2).
 *
 * CTA card shown on the Tier-0 draft screen once `run_report_selfserve` is
 * eligible. Pure presentational — clicking the button calls `onClick()`,
 * which the driver wires to `useCreateCheckoutSession` (Slice 4B).
 */

import { ArrowRight, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StateMachineLoading } from '@/components/state-machine/loading-state'

export interface BuyReportCTAProps {
  /** Displayed price (MVP: SGD $49). Passed in so pricing can be
   *  A/B tested server-side without touching this component. */
  priceLabel?: string
  isStartingCheckout?: boolean
  errorMessage?: string | null
  onClick: () => void
}

export function BuyReportCTA({
  priceLabel = 'SGD $49',
  isStartingCheckout = false,
  errorMessage,
  onClick,
}: BuyReportCTAProps) {
  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader className="flex flex-row items-start gap-3">
        <div className="mt-1 rounded-md bg-primary/10 p-2 text-primary">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </div>
        <div className="flex-1">
          <CardTitle>Buy the full report</CardTitle>
          <CardDescription>
            A structured complaint report drafted against Singapore&apos;s Shared Responsibility
            Framework. Ready to send to the institution in minutes.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="ml-4 list-disc space-y-1 text-sm text-muted-foreground">
          <li>Regulator-aware legal analysis of your case</li>
          <li>Evidence checklist and disputed transactions table</li>
          <li>Requested resolution drafted for you</li>
          <li>Always the latest version — re-run for free when you add new evidence</li>
        </ul>

        {errorMessage ? (
          <p className="text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3 pt-2">
          <div className="text-lg font-semibold">{priceLabel}</div>
          <Button onClick={onClick} disabled={isStartingCheckout} size="lg">
            {isStartingCheckout ? (
              <StateMachineLoading size="inline" title="Redirecting..." />
            ) : (
              <>
                Buy full report
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
