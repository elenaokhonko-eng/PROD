import type { Metadata } from 'next'
import { pageAlternates, pagePreview } from '@/lib/seo/indexing'
import { MarketingPage, MarketingSection } from '@/components/harbor/marketing-page'
import { ContactCard } from '@/components/harbor/contact-disclosure'
import { FAQExplorer } from '@/components/harbor/faq-explorer'
import { paidStagesState } from '@/lib/billing/paid-stages'
import { WhatGuideBuoyIs } from '@/components/harbor/what-guidebuoy-is'
import { JsonLd } from '@/components/seo/json-ld'
import { faqPageJsonLd } from '@/lib/seo/structured-data'

export const metadata: Metadata = {
  title: { absolute: 'Scam and bank dispute questions answered · GuideBuoy FAQ' },
  description: 'Plain answers on getting money back after a scam, bank complaints, FIDReC, costs, privacy and how GuideBuoy works.',
  alternates: pageAlternates('/faq'),
  ...pagePreview('/faq', 'Scam and bank dispute questions answered · GuideBuoy FAQ', 'Plain answers on getting money back after a scam, bank complaints, FIDReC, costs, privacy and how GuideBuoy works.'),
}

export default function FAQPage() {
  const packsLive = paidStagesState().enabled
  return (
    <MarketingPage
      eyebrow="FAQ and contact"
      title="Honest answers for a stressful moment."
      intro="Start here if you are worried about how GuideBuoy works, what it costs or who controls your information."
    >
      {/* Brief W1 §J, §L5: FAQPage from the same list the page shows. */}
      <JsonLd data={faqPageJsonLd(packsLive)} />
      <MarketingSection className="max-w-4xl">
        <FAQExplorer packsLive={packsLive} />
        <WhatGuideBuoyIs className="mt-12" />
        <div className="mt-12"><ContactCard /></div>
      </MarketingSection>
    </MarketingPage>
  )
}
