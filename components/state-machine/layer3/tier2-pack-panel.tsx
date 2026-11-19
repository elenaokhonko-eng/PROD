'use client'

/**
 * The FIDReC pack (S$188) buy card. Stage 2: sold on its own (no bank pack needed first), shown with the route
 * question in FidrecOffer. Wording from the pricing card (lib/harbor/packs.ts) and the paid packs' notice.
 */

import { ArrowRight, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StateMachineLoading } from '@/components/state-machine/loading-state'
import { PACK_ACTION } from '@/lib/harbor/packs'
import { PAID_PACK_NOTICE } from '@/lib/legal/automated-output-notice'

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
            A comprehensive case pack: every material fact, the arguments on both sides, your evidence index.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="ml-4 list-disc space-y-1 text-sm text-muted-foreground">
          <li>Every material fact, in order</li>
          <li>The arguments on both sides, tied to your evidence</li>
          <li>Your evidence index</li>
          <li>Download as PDF</li>
        </ul>
        <p className="rounded-lg border bg-background/70 p-3 text-sm text-muted-foreground" role="note">
          {PAID_PACK_NOTICE}
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
                {disabled ? 'Not available yet' : PACK_ACTION.fidrec}
                {!disabled ? <ArrowRight className="ml-2 h-4 w-4" aria-hidden /> : null}
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
