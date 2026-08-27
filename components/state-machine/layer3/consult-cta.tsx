'use client'

/**
 * Separate SGD 99 human consult CTA (Slice 8).
 *
 * This is a human advice/direction call, distinct from the automated Tier 2
 * FIDReC pack. Recording, transcription, and case-narrative integration are
 * pending Masha's backend workflow.
 */

import { ArrowRight, Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StateMachineLoading } from '@/components/state-machine/loading-state'

export interface ConsultCtaProps {
  priceLabel?: string
  available?: boolean
  isStartingCheckout?: boolean
  errorMessage?: string | null
  onClick: () => void
}

export function ConsultCta({
  priceLabel = 'SGD 99',
  available = false,
  isStartingCheckout = false,
  errorMessage,
  onClick,
}: ConsultCtaProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start gap-3">
        <div className="mt-1 rounded-md bg-muted p-2 text-muted-foreground">
          <Phone className="h-5 w-5" aria-hidden />
        </div>
        <div className="flex-1">
          <CardTitle>Need human direction?</CardTitle>
          <CardDescription>
            Book a 30-minute call with a specialist to review your case, answer questions, and
            advise on next steps. This is human advice, not the automated case pack.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="ml-4 list-disc space-y-1 text-sm text-muted-foreground">
          <li>30-minute video or phone consultation</li>
          <li>Ask questions about your report and FIDReC options</li>
          <li>Get guidance on evidence and timeline</li>
          <li>Call recording and transcript integration coming soon</li>
        </ul>

        {errorMessage ? (
          <p className="text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3 pt-2">
          <div className="gb-num text-lg font-semibold">{priceLabel}</div>
          <Button onClick={onClick} disabled={!available || isStartingCheckout} variant="secondary" size="lg">
            {isStartingCheckout ? (
              <StateMachineLoading size="inline" title="Redirecting..." />
            ) : (
              <>
                {available ? 'Book consult' : 'Bookings opening soon'}
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
