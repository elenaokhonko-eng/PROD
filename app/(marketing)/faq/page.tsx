import type { Metadata } from 'next'
import { MarketingPage, MarketingSection } from '@/components/harbor/marketing-page'
import { ContactCard } from '@/components/harbor/contact-disclosure'
import { FAQExplorer } from '@/components/harbor/faq-explorer'
import { paidStagesState } from '@/lib/billing/paid-stages'
import { WhatGuideBuoyIs } from '@/components/harbor/what-guidebuoy-is'

export const metadata: Metadata = {
  title: { absolute: 'Scam and bank dispute questions answered · GuideBuoy FAQ' },
  description: 'Plain answers on getting money back after a scam, bank complaints, FIDReC, costs, privacy and how GuideBuoy works.',
  alternates: { canonical: '/faq' },
}

export default function FAQPage() {
  return (
    <MarketingPage
      eyebrow="FAQ and contact"
      title="Honest answers for a stressful moment."
      intro="Start here if you are worried about how GuideBuoy works, what it costs or who controls your information."
    >
      <MarketingSection className="max-w-4xl">
        <FAQExplorer packsLive={paidStagesState().enabled} />
        <WhatGuideBuoyIs className="mt-12" />
        <div className="mt-12"><ContactCard /></div>
      </MarketingSection>
    </MarketingPage>
  )
}
