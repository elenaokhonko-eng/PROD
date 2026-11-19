'use client'

/**
 * The FIDReC pack (S$188) offer: the route question before payment, then the buy button (stage2-plan §3a). FIDReC
 * takes a complaint after the bank's final reply (within six months) or four weeks after a written complaint the bank
 * hasn't resolved, so the pack can be bought only on one of those routes; get_case_product_readiness_v1 decides from
 * the answers saved here. The packs are independent: no bank pack or free evaluation is needed first.
 *
 * Wording pending Elena's approval (stage 2 copy list, 20 Nov 2026).
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tier2PackPanel } from '@/components/state-machine/layer3/tier2-pack-panel'
import type { ProductReadinessReason } from '@/lib/billing/product-readiness'

export type FidrecRoute = 'final_reply' | 'no_reply' | 'not_complained'

export interface FidrecOfferProps {
  priceLabel: string
  canCheckout: boolean
  reason: ProductReadinessReason | null
  opensOn: string | null
  checkoutInProgress?: boolean
  isStartingCheckout?: boolean
  errorMessage?: string | null
  onBuy: () => void
  /** Saves fidrec_route and the matching date, then refreshes the capabilities. */
  onSaveRoute: (answers: Record<string, string>) => Promise<void>
}

const ROUTE_OPTIONS: Array<{ value: FidrecRoute; label: string; dateLabel: string | null }> = [
  { value: 'final_reply', label: 'Yes, my bank has given its final reply', dateLabel: 'Date of the final reply' },
  { value: 'no_reply', label: 'I complained in writing and haven’t had a final reply', dateLabel: 'Date of your written complaint' },
  { value: 'not_complained', label: 'I haven’t complained to my bank in writing yet', dateLabel: null },
]

export const FIDREC_REASON_TEXT: Partial<Record<ProductReadinessReason, string>> = {
  complaint_not_raised:
    'FIDReC needs your bank to have had the chance to answer first. Complain to your bank in writing; the bank pack can help you do that.',
  fidrec_window_expired:
    'FIDReC takes complaints up to six months after the bank’s final reply, and that time has passed. Ask your bank to review your complaint again; a new final reply may start a new six-month window.',
}

function tooEarly(opensOn: string | null): string {
  return opensOn
    ? `FIDReC takes a complaint four weeks after your written complaint to the bank. You can get this pack from ${opensOn}.`
    : 'FIDReC takes a complaint four weeks after your written complaint to the bank.'
}

export function FidrecOffer(props: FidrecOfferProps) {
  const [route, setRoute] = useState<FidrecRoute | null>(null)
  const [date, setDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const needsAnswer = props.reason === 'complaint_not_raised' || editing
  const option = ROUTE_OPTIONS.find((o) => o.value === route) ?? null
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10)

  async function save() {
    if (!route) return
    if (option?.dateLabel && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setSaveError('Please enter the date.')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await props.onSaveRoute({
        fidrec_route: route,
        ...(route === 'final_reply' ? { fidrec_final_reply_date: date } : {}),
        ...(route === 'no_reply' ? { fidrec_complaint_date: date } : {}),
      })
      setEditing(false)
    } catch {
      setSaveError('We couldn’t save that. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const blocked =
    props.reason === 'fidrec_too_early'
      ? tooEarly(props.opensOn)
      : props.reason && props.reason !== 'already_purchased' && props.reason !== 'product_not_available'
        ? FIDREC_REASON_TEXT[props.reason] ?? null
        : null

  return (
    <div className="space-y-4" data-fidrec-offer>
      {needsAnswer ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Before the FIDReC pack: where are you with your bank?</CardTitle>
            <CardDescription>
              FIDReC takes a complaint after your bank’s final reply (within six months), or four weeks after a written
              complaint your bank hasn’t resolved.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                void save()
              }}
            >
              <fieldset className="space-y-2">
                <legend className="sr-only">Has your bank given its final reply?</legend>
                {ROUTE_OPTIONS.map((o) => (
                  <label key={o.value} className="flex min-h-11 items-center gap-3 rounded-control border px-3 text-sm">
                    <input
                      type="radio"
                      name="fidrec-route"
                      value={o.value}
                      checked={route === o.value}
                      onChange={() => setRoute(o.value)}
                    />
                    {o.label}
                  </label>
                ))}
              </fieldset>
              {option?.dateLabel ? (
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">{option.dateLabel}</span>
                  <input
                    type="date"
                    className="block min-h-11 rounded-control border px-3"
                    max={today}
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                    required
                  />
                </label>
              ) : null}
              {saveError ? <p role="alert" className="text-sm text-destructive">{saveError}</p> : null}
              <Button type="submit" className="min-h-11" disabled={!route || saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {blocked && !needsAnswer ? (
        <p role="status" className="rounded-lg border bg-muted/40 p-4 text-sm">
          {blocked}{' '}
          <button type="button" className="underline" onClick={() => setEditing(true)}>
            Change my answer
          </button>
        </p>
      ) : null}

      <Tier2PackPanel
        priceLabel={props.priceLabel}
        disabled={!props.canCheckout}
        unavailableReason={
          props.canCheckout
            ? undefined
            : props.checkoutInProgress
              ? 'A checkout for this pack is already in progress.'
              : needsAnswer
                ? 'Answer the question above first.'
                : 'This pack isn’t available for your case yet.'
        }
        isStartingCheckout={props.isStartingCheckout}
        errorMessage={props.errorMessage}
        onClick={props.onBuy}
      />
    </div>
  )
}
