import type { Metadata } from 'next'
import Link from 'next/link'
import { Info } from 'lucide-react'
import { MarketingPage, MarketingSection } from '@/components/harbor/marketing-page'
import { PackComparison } from '@/components/harbor/pack-comparison'
import { Button } from '@/components/ui/button'
import { StartEvaluationButton } from '@/components/harbor/start-evaluation-button'

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Start GuideBuoy for free and see each optional one-off pack price before checkout.',
  alternates: { canonical: '/pricing' },
}

export default function PricingPage() {
  return (
    <MarketingPage
      eyebrow="Clear, one-off prices"
      title="Free to start. Paid only when you choose more."
      intro="Each option builds a more detailed record: the free evaluation organises and assesses your case, the bank pack turns it into a formal complaint, and the FIDReC pack is a complete case pack for FIDReC’s process. No pack guarantees an outcome."
    >
      <MarketingSection>
        <PackComparison />
        <aside className="mt-8 rounded-card border bg-harbor-teal-tint p-4 sm:p-6" aria-labelledby="fine-print-title">
          <div className="flex gap-4">
            <Info className="mt-1 size-6 shrink-0 text-harbor-blue" aria-hidden="true" />
            <div>
              <h2 id="fine-print-title" className="text-xl font-semibold">Honest fine print</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 leading-7 text-muted-foreground">
                <li>GuideBuoy is not a law firm and does not provide legal advice.</li>
                <li>Banks, FIDReC and authorities make their own decisions.</li>
                <li>When the paid packs are available, you&apos;ll pay through our payment provider&apos;s secure checkout. The price and contents are shown before you pay.</li>
                <li>Generated automatically by GuideBuoy AI using a pre-built workflow. It has not been reviewed by a person. For a human review, book a consultation (S$99 / 30 min).</li>
              </ul>
            </div>
          </div>
        </aside>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <StartEvaluationButton />
          <Button asChild variant="outline"><Link href="/how-it-works">See how it works</Link></Button>
        </div>
      </MarketingSection>
    </MarketingPage>
  )
}
