'use client'

/**
 * Transition node `T-CheckoutRedirect` (SM Diagram 2).
 *
 * Brief full-screen "Redirecting to secure payment..." while the server
 * route `/api/payments/create-checkout-session` returns a Stripe Checkout
 * URL and the driver calls `window.location.assign(...)`.
 *
 * Intentionally thin — the real work happens in the hook and the browser
 * navigation. Expected visible duration: 300–1000 ms.
 */

import { StateMachineLoading } from '@/components/state-machine/loading-state'

export function CheckoutRedirect() {
  return (
    <StateMachineLoading
      size="full"
      title="Redirecting to secure payment"
      description="Stripe handles payment on their own page — you'll be back in a moment."
    />
  )
}
