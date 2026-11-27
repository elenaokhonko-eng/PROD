'use client'

/**
 * The FIDReC pack (S$188) offer: sold upfront to everyone, with a plain statement and no question before payment
 * (CR-2, amended 27 Nov 2026). The timeline questionnaire follows payment. The packs are independent: no bank pack or
 * free evaluation is needed first.
 */

import { Tier2PackPanel } from '@/components/state-machine/layer3/tier2-pack-panel'
import { PackEvidenceNote } from '@/components/state-machine/facts/pack-evidence'
import { FIDREC_BEFORE_PAYMENT } from '@/lib/journey/fidrec-timeline'

export interface FidrecOfferProps {
  priceLabel: string
  canCheckout: boolean
  checkoutInProgress?: boolean
  isStartingCheckout?: boolean
  errorMessage?: string | null
  onBuy: () => void
}

export function FidrecOffer(props: FidrecOfferProps) {
  return (
    <div className="space-y-4" data-fidrec-offer>
      <p className="rounded-lg border bg-muted/40 p-4 text-sm" data-fidrec-before-payment>
        {FIDREC_BEFORE_PAYMENT}
      </p>
      <Tier2PackPanel
        priceLabel={props.priceLabel}
        disabled={!props.canCheckout}
        unavailableReason={
          props.canCheckout
            ? undefined
            : props.checkoutInProgress
              ? 'A checkout for this pack is already in progress.'
              : 'This pack isn’t available for your case yet.'
        }
        isStartingCheckout={props.isStartingCheckout}
        errorMessage={props.errorMessage}
        onClick={props.onBuy}
      />
      <PackEvidenceNote product="fidrec" />
    </div>
  )
}
