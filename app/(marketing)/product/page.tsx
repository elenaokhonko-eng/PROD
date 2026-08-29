import type { Metadata } from 'next'
import Link from 'next/link'
import { FileCheck2, LockKeyhole } from 'lucide-react'
import { MarketingPage, MarketingSection } from '@/components/harbor/marketing-page'
import { StepJourney } from '@/components/harbor/step-journey'
import { Button } from '@/components/ui/button'
import { PRODUCT_CATALOGUE } from '@/lib/payments/product-catalogue'

export const metadata: Metadata = {
  title: 'Product',
  description: 'See how GuideBuoy organises your story, evidence, questions and report in one calm case workspace.',
  alternates: { canonical: '/product' },
}

const steps = [
  { title: 'Tell your story', description: 'Type or record what happened in your own words.' },
  { title: 'Save your case', description: 'Sign in to keep your story and continue in a private case workspace.' },
  { title: 'Add evidence', description: 'Upload available documents through the guided evidence area.' },
  { title: 'Fill the gaps', description: 'Answer focused questions generated from the information available in your case.' },
  { title: 'Review the free draft', description: 'Check the organised story, evidence status and next-step information.' },
  { title: 'Choose whether to upgrade', description: 'If the server confirms eligibility, you can choose a one-off full report.' },
] as const

export default function ProductPage() {
  const fullReportPrice = `S$${PRODUCT_CATALOGUE.self_serve_report.amountSgd}`

  return (
    <MarketingPage
      eyebrow="The product"
      title="One calm place to organise what happened."
      intro="GuideBuoy keeps your story, evidence, questions and generated documents together while you decide what to do next."
    >
      <MarketingSection>
        <StepJourney steps={steps} />
      </MarketingSection>

      <section className="border-y bg-harbor-surface py-12 sm:py-16" aria-labelledby="preview-title">
        <div className="gb-container grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.75fr)]">
          <div className="gb-readable">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">Live report preview</p>
            <h2 id="preview-title" className="mt-3 text-3xl font-semibold text-harbor-primary-active">
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

          <aside className="rounded-card border bg-harbor-warning-subtle p-4 sm:p-6" aria-labelledby="boundary-title">
            <LockKeyhole className="size-6 text-harbor-warning" aria-hidden="true" />
            <h2 id="boundary-title" className="mt-3 text-xl font-semibold">Free and paid boundary</h2>
            <p className="mt-3 leading-7">Start, save a case, add evidence, answer questions and review the available free draft without paying.</p>
            <p className="mt-3 leading-7"><strong>Full report — {fullReportPrice}.</strong> It is offered only when the server confirms that the case is eligible.</p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Generated automatically by GuideBuoy AI. It has not been reviewed by a person.
            </p>
          </aside>
        </div>
      </section>

      <MarketingSection className="text-center">
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild><Link href="/">Start organising — free</Link></Button>
          <Button asChild variant="outline"><Link href="/how-it-works">See how it works</Link></Button>
          <Button asChild variant="ghost"><Link href="/pricing">View pricing</Link></Button>
        </div>
      </MarketingSection>
    </MarketingPage>
  )
}
