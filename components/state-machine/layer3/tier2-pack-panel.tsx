'use client'

/**
 * Layer 3 Tier 2 pack offer panel (Slice 8).
 *
 * Shown when the case has a completed Tier 1 self-serve report but the user
 * has not yet purchased the SGD 188 FIDReC Tier 2 pack.
 */

import { ArrowRight, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StateMachineLoading } from '@/components/state-machine/loading-state'

export interface Tier2PackPanelProps {
  priceLabel?: string
  isStartingCheckout?: boolean
  errorMessage?: string | null
  disabled?: boolean
  unavailableReason?: string
  onClick: () => void
}

export function Tier2PackPanel({
  priceLabel = 'S$188',
  isStartingCheckout = false,
  errorMessage,
  disabled = false,
  unavailableReason,
  onClick,
}: Tier2PackPanelProps) {
  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader className="flex flex-row items-start gap-3">
        <div className="mt-1 rounded-md bg-primary/10 p-2 text-primary">
          <FileText className="h-5 w-5" aria-hidden />
        </div>
        <div className="flex-1">
          <CardTitle>Prepare your FIDReC submission</CardTitle>
          <CardDescription>
            Upgrade to a structured Tier 2 case pack with an executive summary and chronology you can
            download and submit to FIDReC.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="ml-4 list-disc space-y-1 text-sm text-muted-foreground">
          <li>Executive summary of your dispute</li>
          <li>Chronology / timeline of events</li>
          <li>Issues in dispute and your position</li>
          <li>Evidence bundle index and annexures</li>
          <li>Download as PDF or Markdown</li>
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
            ) : (
              <>
                <FileText className="mr-2 h-4 w-4" aria-hidden />
                {disabled ? 'Tier 2 unavailable' : 'Buy Tier 2 pack'}
                {!disabled ? <ArrowRight className="ml-2 h-4 w-4" aria-hidden /> : null}
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
