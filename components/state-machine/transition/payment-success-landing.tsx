'use client'

/**
 * Transition node `T-PaymentSuccessLanding` (SM Diagram 2).
 *
 * Stripe's return URL (`/app/case/[id]/checkout/success`). The webhook +
 * background job may or may not have finished by the time the user lands
 * here — that's fine. This screen simply acknowledges the payment and
 * routes the user into Layer 2, whose first state `L2-DecisionRunning`
 * is itself a Realtime-driven waiting state.
 *
 * The "Continue" button is optional: the driver may auto-navigate once
 * `case_entitlements.plan === 'self_serve_report'` is observed (SM §4).
 */

import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export interface PaymentSuccessLandingProps {
  onContinue?: () => void
  /** Displayed while the entitlement upgrade / job insert is still in
   *  flight. Defaults to `true` — the driver flips to `false` once
   *  `case_entitlements.plan === 'self_serve_report'`. */
  isConfirming?: boolean
}

export function PaymentSuccessLanding({
  onContinue,
  isConfirming = true,
}: PaymentSuccessLandingProps) {
  return (
    <Card className="mx-auto max-w-md border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/20">
      <CardHeader className="flex flex-row items-start gap-3">
        <div className="mt-1 rounded-full bg-emerald-100 p-2 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        </div>
        <div className="flex-1">
          <CardTitle>Payment received</CardTitle>
          <CardDescription>
            {isConfirming
              ? "We're setting up your full report. This usually takes a few seconds."
              : 'Your report is being generated. We\'ll take you there now.'}
          </CardDescription>
        </div>
      </CardHeader>
      {onContinue ? (
        <CardContent>
          <Button onClick={onContinue} size="lg" className="w-full">
            Continue to report
          </Button>
        </CardContent>
      ) : null}
    </Card>
  )
}
