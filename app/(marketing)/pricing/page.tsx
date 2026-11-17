import type { Metadata } from 'next'
import { pageAlternates } from '@/lib/seo/indexing'
import Link from 'next/link'
import { Info } from 'lucide-react'
import { MarketingPage, MarketingSection } from '@/components/harbor/marketing-page'
import { PackComparison } from '@/components/harbor/pack-comparison'
import { Button } from '@/components/ui/button'
import { StartEvaluationButton } from '@/components/harbor/start-evaluation-button'
import { WhatGuideBuoyIs } from '@/components/harbor/what-guidebuoy-is'
import { NO_CARD_LINE } from '@/lib/harbor/cta'
import { GST_LINE, REFUNDS_LINE } from '@/lib/harbor/packs'

export const metadata: Metadata = {
  title: { absolute: 'GuideBuoy pricing: free evaluation, S$18 bank pack, S$188 FIDReC pack' },
  description: 'One-off prices, shown before you pay. Start free; choose a pack only if you need one.',
  alternates: pageAlternates('/pricing'),
}

export default function PricingPage() {
  return (
    <MarketingPage
      eyebrow="Clear, one-off prices"
      title="Free to start. Paid only when you choose more."
      action={
        <>
          <StartEvaluationButton />
          <p className="text-sm text-muted-foreground">{NO_CARD_LINE}</p>
        </>
      }
    >
      <MarketingSection>
        <PackComparison />
        <aside className="mt-8 rounded-card border bg-harbor-teal-tint p-4 sm:p-6" aria-labelledby="fine-print-title">
          <div className="flex gap-4">
            <Info className="mt-1 size-6 shrink-0 text-harbor-blue" aria-hidden="true" />
            <div>
              <h2 id="fine-print-title" className="text-xl font-semibold">Honest fine print</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 leading-7 text-muted-foreground">
                {/* Brief W1 §E4: "minus the repeated notice"; the What GuideBuoy is block below says it is not legal advice. */}
                <li>Banks, FIDReC and authorities make their own decisions.</li>
                <li>When the paid packs are available, you&apos;ll pay through our payment provider&apos;s secure checkout. The price and contents are shown before you pay.</li>
                <li>{GST_LINE}</li>
                <li>
                  {REFUNDS_LINE}{' '}
                  <Link href="/terms#section-6" className="font-medium text-foreground underline">Terms, clause 6.4</Link>
                </li>
              </ul>
            </div>
          </div>
        </aside>
        <WhatGuideBuoyIs className="mt-9" />
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <StartEvaluationButton />
          <Button asChild variant="outline"><Link href="/how-it-works">See how it works</Link></Button>
        </div>
      </MarketingSection>
    </MarketingPage>
  )
}
