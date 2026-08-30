export interface CheckoutSessionSnapshot {
  id: string
  status: string | null
  url: string | null
  paymentIntentId: string | null
}

export interface CheckoutSessionOrchestrationDeps {
  createSession: (idempotencyKey: string) => Promise<CheckoutSessionSnapshot>
  attachSession: (session: CheckoutSessionSnapshot) => Promise<void>
  expireSession: (sessionId: string) => Promise<{ status: string | null }>
  cancelReservation: (sessionId: string) => Promise<void>
}

export type CheckoutSessionOrchestrationResult =
  | { status: "ready"; url: string }
  | { status: "closed" }
  | { status: "retryable"; reason: "create_ambiguous" | "attach_ambiguous" }

export function checkoutSessionIdempotencyKey(casePurchaseId: string): string {
  return `case-purchase:${casePurchaseId}`
}

/**
 * Keeps the local reservation recoverable across Stripe's two ambiguous windows.
 * Local cancellation is allowed only after Stripe positively reports expiration.
 */
export async function establishCheckoutSession(
  deps: CheckoutSessionOrchestrationDeps,
  casePurchaseId: string,
): Promise<CheckoutSessionOrchestrationResult> {
  let session: CheckoutSessionSnapshot
  try {
    session = await deps.createSession(checkoutSessionIdempotencyKey(casePurchaseId))
  } catch {
    return { status: "retryable", reason: "create_ambiguous" }
  }

  if (session.status !== "open" || !session.url) {
    if (session.status === "expired") {
      try {
        await deps.cancelReservation(session.id)
      } catch {
        return { status: "retryable", reason: "attach_ambiguous" }
      }
    }
    return { status: "closed" }
  }

  try {
    await deps.attachSession(session)
  } catch {
    try {
      const expired = await deps.expireSession(session.id)
      if (expired.status !== "expired") {
        return { status: "retryable", reason: "attach_ambiguous" }
      }
      await deps.cancelReservation(session.id)
    } catch {
      return { status: "retryable", reason: "attach_ambiguous" }
    }
    return { status: "retryable", reason: "attach_ambiguous" }
  }

  return { status: "ready", url: session.url }
}
