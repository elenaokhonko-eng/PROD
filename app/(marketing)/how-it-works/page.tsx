import type { Metadata } from 'next'
import { pageAlternates } from '@/lib/seo/indexing'
import Link from 'next/link'
import { MarketingPage, MarketingSection } from '@/components/harbor/marketing-page'
import { StepJourney } from '@/components/harbor/step-journey'
import { PathwayChip } from '@/components/harbor/pathway-chip'
import { WaitingTracker } from '@/components/harbor/waiting-tracker'
import { Button } from '@/components/ui/button'
import { StartEvaluationButton } from '@/components/harbor/start-evaluation-button'
import { WhatGuideBuoyIs } from '@/components/harbor/what-guidebuoy-is'

export const metadata: Metadata = {
  title: { absolute: 'How GuideBuoy prepares your scam or bank dispute, step by step' },
  description: 'From your story to a checked record and a suggested next step in six steps. Free to start, no card.',
  alternates: pageAlternates('/how-it-works'),
}

const steps = [
  { title: 'Tell GuideBuoy what happened', description: 'Type or speak in plain language. GuideBuoy transcribes voice and helps identify the kind of complaint without judging how you tell it.' },
  { title: 'Save your case and add proof', description: 'Create an account, then add screenshots, statements, messages, receipts or reference numbers. Even one document is enough to begin.' },
  { title: 'Answer focused questions', description: 'GuideBuoy asks only for details that are missing. “I’m not sure” is always acceptable while documents process in the background.' },
  { title: 'Confirm your facts, then receive your free evaluation', description: 'Check what GuideBuoy found in your story, answers and documents, settle anything that differs, then review your free evaluation.' },
  { title: 'See your suggested next step', description: 'Based on the facts you confirmed, GuideBuoy suggests a next step and explains why. The choice remains yours.' },
  { title: 'Choose a separate pack if you need one', description: 'A bank dispute pack before your bank’s final reply, or a FIDReC escalation pack after it. Each is separate; neither requires the other.' },
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
          <h2 id="paths-title" className="text-[1.75rem] leading-tight font-semibold sm:text-[2rem] text-harbor-deep">Complaint paths in plain words</h2>
          <div className="mt-6 flex flex-wrap gap-3">
            <PathwayChip>Bank or financial institution</PathwayChip>
            <PathwayChip tone="formal">FIDReC</PathwayChip>
            <PathwayChip>IMDA or telco</PathwayChip>
            <PathwayChip tone="formal">Police and ScamShield</PathwayChip>
            <PathwayChip tone="waiting">Crypto or overseas platform</PathwayChip>
          </div>
          <p className="mt-6 max-w-3xl leading-7 text-muted-foreground">A suggested next step is informational, not a decision. The relevant organisation or authority decides what happens next.</p>
        </div>
      </section>
      <MarketingSection>
        <WaitingTracker />
        <WhatGuideBuoyIs className="mt-9" />
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <StartEvaluationButton />
          <Button asChild variant="outline"><Link href="/faq">Read the FAQ</Link></Button>
        </div>
      </MarketingSection>
    </MarketingPage>
  )
}
