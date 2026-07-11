'use client'

/**
 * Transition node `T-PaymentCancelled` (SM Diagram 2).
 *
 * Stripe's cancel URL. No payment went through — no webhook, no entitlement
 * change, no job. User can retry or drop back to the free Tier-0 draft.
 */

import { XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export interface PaymentCancelledProps {
  onTryAgain?: () => void
  onBackToDraft?: () => void
}

export function PaymentCancelled({ onTryAgain, onBackToDraft }: PaymentCancelledProps) {
  return (
    <Card className="mx-auto max-w-md">
      <CardHeader className="flex flex-row items-start gap-3">
        <div className="mt-1 rounded-full bg-muted p-2 text-muted-foreground">
          <XCircle className="h-6 w-6" aria-hidden />
        </div>
        <div className="flex-1">
          <CardTitle>Payment cancelled</CardTitle>
          <CardDescription>
            No payment was taken. You can retry the checkout whenever you&apos;re ready.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 sm:flex-row">
        {onTryAgain ? (
          <Button onClick={onTryAgain} className="flex-1">
            Try again
          </Button>
        ) : null}
        {onBackToDraft ? (
          <Button variant="outline" onClick={onBackToDraft} className="flex-1">
            Back to free draft
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
