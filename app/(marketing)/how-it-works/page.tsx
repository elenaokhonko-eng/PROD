import type { Metadata } from 'next'
import Link from 'next/link'
import { MarketingPage, MarketingSection } from '@/components/harbor/marketing-page'
import { StepJourney } from '@/components/harbor/step-journey'
import { PathwayChip } from '@/components/harbor/pathway-chip'
import { WaitingTracker } from '@/components/harbor/waiting-tracker'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = {
  title: 'How it works',
  description: 'See how GuideBuoy turns a plain-language story into an organised complaint record in six calm steps.',
  alternates: { canonical: '/how-it-works' },
}

const steps = [
  { title: 'Tell Lumi what happened', description: 'Type or speak in plain language. Lumi transcribes voice and helps identify the kind of complaint without judging how you tell it.' },
  { title: 'Save your case and add proof', description: 'Create an account, then add screenshots, statements, messages, receipts or reference numbers. Even one document is enough to begin.' },
  { title: 'Answer focused questions', description: 'Lumi asks only for details that are missing. “I’m not sure” is always acceptable while documents process in the background.' },
  { title: 'Receive your free draft', description: 'Review a story summary, evidence checklist and preliminary pathway signal together in your Report Hub.' },
  { title: 'Choose your next step', description: 'Keep using the free draft or choose a paid full report for a bank complaint. The choice remains yours.' },
  { title: 'Review available next steps', description: 'A completed report may show further case-preparation options when the server confirms they are available for your case.' },
] as const

export default function HowItWorksPage() {
  return (
    <MarketingPage
      eyebrow="Six calm steps"
      title="From something went wrong to here’s my organised case."
      intro="GuideBuoy keeps the information you add to your case workspace so you can review your story, evidence and next steps together."
    >
      <MarketingSection>
        <StepJourney steps={steps} />
      </MarketingSection>
      <section className="border-y bg-card py-12 sm:py-16" aria-labelledby="paths-title">
        <div className="gb-container">
          <h2 id="paths-title" className="text-3xl font-semibold text-harbor-deep">Complaint paths in plain words</h2>
          <div className="mt-6 flex flex-wrap gap-3">
            <PathwayChip>Bank or financial institution</PathwayChip>
            <PathwayChip tone="formal">FIDReC</PathwayChip>
            <PathwayChip>IMDA or telco</PathwayChip>
            <PathwayChip tone="formal">Police and ScamShield</PathwayChip>
            <PathwayChip tone="waiting">Crypto or overseas platform</PathwayChip>
          </div>
          <p className="mt-6 max-w-3xl leading-7 text-muted-foreground">Pathway signals are informational, not decisions. The relevant organisation or authority decides what happens next.</p>
        </div>
      </section>
      <MarketingSection>
        <WaitingTracker />
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Button asChild><Link href="/">Start organising — free</Link></Button>
          <Button asChild variant="outline"><Link href="/faq">Read the FAQ</Link></Button>
        </div>
      </MarketingSection>
    </MarketingPage>
  )
}
