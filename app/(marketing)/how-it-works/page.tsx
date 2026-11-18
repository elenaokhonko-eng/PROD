import type { Metadata } from 'next'
import { pageAlternates } from '@/lib/seo/indexing'
import Link from 'next/link'
import { MarketingPage, MarketingSection } from '@/components/harbor/marketing-page'
import { FileCheck2 } from 'lucide-react'
import { StepJourney } from '@/components/harbor/step-journey'
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
        {/* Brief W1 §I: a primary button after step 4 as well as at the end. */}
        <StepJourney steps={steps} actionAfterStep={4} action={<StartEvaluationButton />} />
        <p className="mt-6 max-w-3xl leading-7 text-muted-foreground">A suggested next step is informational, not a decision. The relevant organisation or authority decides what happens next.</p>
      </MarketingSection>
      {/* Brief W1 §I: the report outline from the retired /product page, word for word. The "Complaint paths" row is
          removed (Elena, 18 Nov). */}
      <section className="bg-harbor-surface py-12 sm:py-16" aria-labelledby="preview-title">
        <div className="gb-container gb-readable">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">Live report preview</p>
          <h2 id="preview-title" className="mt-3 text-[1.75rem] leading-tight font-semibold sm:text-[2rem] text-harbor-primary-active">
            A structure you can review before using
          </h2>
          <p className="mt-4 leading-7 text-muted-foreground">
            Report sections are assembled from the information in your case. Missing or uncertain details remain visible rather than being guessed.
          </p>
          <div className="mt-6 rounded-card border bg-background p-4 sm:p-6">
            <div className="flex items-center gap-3 border-b pb-4">
              <FileCheck2 className="size-6 text-harbor-info" aria-hidden="true" />
              <div>
                <p className="font-semibold">Complaint report</p>
                <p className="text-sm text-muted-foreground">Preview structure</p>
              </div>
            </div>
            <ol className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              {['Summary', 'Chronology', 'Transactions', 'Evidence', 'Open questions', 'Limitations'].map((section, index) => (
                <li key={section} className="flex min-h-11 items-center gap-3 rounded-control bg-harbor-surface-subtle px-3">
                  <span className="tabular-nums text-muted-foreground">{index + 1}</span>
                  <span className="font-medium">{section}</span>
                </li>
              ))}
            </ol>
          </div>
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
