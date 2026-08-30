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
  /** Displayed price. The state-machine owner passes the authoritative catalogue amount. */
  priceLabel: string
  isStartingCheckout?: boolean
  errorMessage?: string | null
  disabled?: boolean
  unavailableReason?: string
  onClick: () => void
}

export function BuyReportCTA({
  priceLabel,
  isStartingCheckout = false,
  errorMessage,
  disabled = false,
  unavailableReason,
  onClick,
}: BuyReportCTAProps) {
  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader className="flex flex-row items-start gap-3">
        <div className="mt-1 rounded-md bg-primary/10 p-2 text-primary">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </div>
        <div className="flex-1">
          <CardTitle>Get your Bank Pack</CardTitle>
          <CardDescription>
            A structured complaint report organised against Singapore&apos;s Shared Responsibility
            Framework, ready for you to review before sending.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="ml-4 list-disc space-y-1 text-sm text-muted-foreground">
          <li>Structured analysis of the issues in your case</li>
          <li>Evidence checklist and disputed transactions table</li>
          <li>Requested resolution drafted for you</li>
        </ul>
        <p className="rounded-lg border bg-background/70 p-3 text-sm text-muted-foreground" role="note">
          Generated automatically by GuideBuoy AI. It has not been reviewed by a person.
        </p>

        {unavailableReason ? (
          <p className="text-sm text-muted-foreground" role="status">
            {unavailableReason}
          </p>
        ) : null}
        {errorMessage ? (
          <p className="text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3 pt-2">
          <div className="text-lg font-semibold">{priceLabel}</div>
          <Button onClick={onClick} disabled={disabled || isStartingCheckout} size="lg">
            {isStartingCheckout ? (
              <StateMachineLoading size="inline" title="Redirecting..." />
            ) : disabled ? (
              'Checkout unavailable'
            ) : (
              <>
                Get Bank Pack
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
