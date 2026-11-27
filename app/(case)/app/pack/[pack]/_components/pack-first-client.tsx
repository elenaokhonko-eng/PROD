'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@clerk/nextjs'
import { Button } from '@/components/ui/button'
import { PACK_NAMES } from '@/components/state-machine/facts/pack-evidence'
import { StateMachineLoading } from '@/components/state-machine/loading-state'
import { CheckoutRedirect } from '@/components/state-machine/transition/checkout-redirect'
import { EMPTY_FIDREC_ROUTE_DRAFT, FidrecOffer, type FidrecRouteDraft } from '@/components/state-machine/transition/fidrec-offer'
import { useFidrecRoute } from '@/hooks/state-machine/facts/use-fidrec-route'
import { useCreateCheckoutSession, type ProductKey } from '@/hooks/state-machine/transition/use-create-checkout-session'
import { usePaymentStatus } from '@/hooks/state-machine/transition/use-payment-status'
import type { PaidPack } from '@/lib/harbor/packs'
import { fidrecRouteResponses } from '@/lib/journey/fidrec-route-answers'

const OPEN_FAILED = 'We couldn’t open the payment step. Please try again; if it keeps happening, email info@guidebuoyai.sg.'
// Just after sign-up the account can take a few seconds to be linked, so "not signed in" is retried quietly first.
const ACCOUNT_LINK_RETRIES = 3
const ACCOUNT_LINK_RETRY_MS = 2000

type Props = { pack: PaidPack; available: boolean; priceLabel: string }

export function PackFirstClient({ pack, available, priceLabel }: Props) {
  const router = useRouter()
  const { getToken } = useAuth()
  const createCheckout = useCreateCheckoutSession()
  const [caseId, setCaseId] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [redirecting, setRedirecting] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const startedAttempt = useRef<number | null>(null)

  async function buy(productKey: ProductKey, id: string | null = caseId) {
    if (!id) return
    setCheckoutError(null)
    try {
      // A new account's cached token can predate its profile link.
      await getToken({ template: 'supabase', skipCache: true })
      const checkout = await createCheckout.mutateAsync({ caseId: id, productKey })
      if (checkout.status === 'reconciled') {
        router.replace('/app')
        return
      }
      setRedirecting(true)
      // Back from Stripe lands on My cases, not on this step, which would open Stripe again.
      window.history.replaceState(null, '', '/app')
      window.location.assign(checkout.url)
    } catch (error) {
      setRedirecting(false)
      setCheckoutError(error instanceof Error ? error.message : 'Could not start checkout')
    }
  }

  // A page restored by the browser's Back button must not stay on "Redirecting to secure payment".
  useEffect(() => {
    const leave = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.replace('/app')
    }
    window.addEventListener('pageshow', leave)
    return () => window.removeEventListener('pageshow', leave)
  }, [])

  useEffect(() => {
    if (!available || startedAttempt.current === attempt) return
    startedAttempt.current = attempt
    setOpenError(null)
    void (async () => {
      try {
        const open = () =>
          fetch('/api/cases/pack-first', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ product: pack }),
          })
        let response = await open()
        for (let retry = 0; response.status === 401 && retry < ACCOUNT_LINK_RETRIES; retry++) {
          await new Promise((resolve) => setTimeout(resolve, ACCOUNT_LINK_RETRY_MS))
          response = await open()
        }
        const data = (await response.json().catch(() => null)) as { case_id?: string; owned?: boolean; error?: string } | null
        if (!response.ok || !data?.case_id) {
          // A reached limit says so in the server's own words.
          setOpenError(response.status === 429 && data?.error ? data.error : OPEN_FAILED)
          return
        }
        if (data.owned) {
          router.replace('/app')
          return
        }
        setCaseId(data.case_id)
        if (pack === 'bank') await buy('self_serve_report', data.case_id)
      } catch {
        setOpenError(OPEN_FAILED)
      }
    })()
    // buy is recreated on every render; each attempt runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, available, pack])

  const failed = openError ?? (pack === 'bank' ? checkoutError : null)

  return (
    <main className="gb-container py-8 sm:py-12" data-pack-first={pack}>
      <div className="mx-auto max-w-2xl space-y-5">
        <h1 className="gb-display text-3xl font-semibold text-harbor-deep">{PACK_NAMES[pack]}</h1>

        {!available ? (
          <p className="gb-card p-5" role="status">Coming shortly</p>
        ) : failed ? (
          <div className="gb-card space-y-3 p-5">
            <p role="alert" className="text-sm text-destructive">{failed}</p>
            <Button className="min-h-11" onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </Button>
          </div>
        ) : redirecting || pack === 'bank' ? (
          <CheckoutRedirect />
        ) : caseId ? (
          <FidrecStep
            caseId={caseId}
            priceLabel={priceLabel}
            isStartingCheckout={createCheckout.isPending}
            errorMessage={checkoutError}
            buy={buy}
          />
        ) : (
          <StateMachineLoading title="Loading your case" />
        )}

        <Link href="/app" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline">
          My cases
        </Link>
      </div>
    </main>
  )
}

/** The route question and the FIDReC pack's buy button, as on a case page, for the case created for this pack. */
function FidrecStep({
  caseId,
  priceLabel,
  isStartingCheckout,
  errorMessage,
  buy,
}: {
  caseId: string
  priceLabel: string
  isStartingCheckout: boolean
  errorMessage: string | null
  buy: (productKey: ProductKey, id?: string) => Promise<void>
}) {
  const router = useRouter()
  const { getToken } = useAuth()
  const payment = usePaymentStatus(caseId)
  const route = useFidrecRoute(caseId)
  const [draft, setDraft] = useState<FidrecRouteDraft>(EMPTY_FIDREC_ROUTE_DRAFT)
  const capability = payment.data?.capabilityBilling.capabilities.fidrecPack
  const owned = capability?.entitled === true
  const reconciling = capability?.reconciliationRequired === true

  // Already bought for the case still waiting for its story: nothing more to pay. A recorded payment whose access is
  // missing is repaired by the checkout route, which then returns "reconciled".
  useEffect(() => {
    if (owned) router.replace('/app')
  }, [owned, router])
  useEffect(() => {
    if (reconciling) void buy('fidrec_tier2_pack', caseId)
    // Once per case.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconciling, caseId])

  async function saveRoute(answers: Record<string, string>) {
    const token = await getToken({ template: 'supabase' })
    if (!token) throw new Error('Missing Supabase token')
    const response = await fetch(`/api/cases/${caseId}/responses`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ responses: fidrecRouteResponses(answers, route.data ?? null) }),
    })
    if (!response.ok) throw new Error('Failed to save responses')
    await Promise.all([payment.refetch(), route.refetch()])
  }

  if (payment.isPending) return <StateMachineLoading title="Loading your case" />
  if (payment.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Checkout status could not be loaded. Refresh before trying again.
      </p>
    )
  }

  return (
    <FidrecOffer
      priceLabel={priceLabel}
      canCheckout={capability?.canCheckout === true}
      reason={capability?.reason ?? null}
      opensOn={capability?.opensOn ?? null}
      checkoutInProgress={capability?.checkoutInProgress === true}
      isStartingCheckout={isStartingCheckout}
      errorMessage={errorMessage}
      onBuy={() => void buy('fidrec_tier2_pack')}
      onSaveRoute={saveRoute}
      savedRoute={route.isError ? null : route.data}
      draft={draft}
      onDraftChange={setDraft}
    />
  )
}
