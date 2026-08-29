import type { Metadata } from 'next'
import { MarketingPage, MarketingSection } from '@/components/harbor/marketing-page'
import { ContactCard } from '@/components/harbor/contact-disclosure'
import { FAQExplorer } from '@/components/harbor/faq-explorer'

export const metadata: Metadata = {
  title: 'FAQ and contact',
  description: 'Honest answers about starting a GuideBuoy case, reports, one-off packs, privacy and support.',
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
        <FAQExplorer />
        <div className="mt-12"><ContactCard /></div>
      </MarketingSection>
    </MarketingPage>
  )
}
