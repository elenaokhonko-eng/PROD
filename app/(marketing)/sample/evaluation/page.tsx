import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Info } from 'lucide-react'
import { MarketingPage, MarketingSection } from '@/components/harbor/marketing-page'
import { StartEvaluationButton } from '@/components/harbor/start-evaluation-button'
import { WhatGuideBuoyIs } from '@/components/harbor/what-guidebuoy-is'
import { Tier0DraftView } from '@/components/state-machine/layer1/tier0-draft-view'
import { NOINDEX } from '@/lib/seo/indexing'
import { SAMPLE_BANNER, loadSampleRows, sampleBundle } from '@/lib/samples/free-evaluation'

// Brief W1 §H: the free evaluation of the fictional case, exactly as the app shows it, read-only. Not indexed or linked
// until Elena has reviewed it on staging.
export const metadata: Metadata = {
  title: 'Sample free evaluation',
  description: 'What a GuideBuoy free evaluation looks like, shown for a fictional case.',
  robots: NOINDEX,
}

export default function SampleEvaluationPage() {
  const rows = loadSampleRows()
  if (!rows) notFound()
  return (
    <MarketingPage eyebrow="Sample" title="A sample free evaluation">
      <MarketingSection className="max-w-4xl">
        {/* Brief W1 §H: the banner stays at the top of the sample, word for word. */}
        <p
          role="note"
          data-testid="sample-banner"
          className="sticky top-[calc(env(safe-area-inset-top,0px)+4.5rem)] z-10 flex items-start gap-3 rounded-card border border-harbor-warning/40 bg-harbor-warning-tint p-4 font-medium"
        >
          <Info className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          {SAMPLE_BANNER}
        </p>
        <div className="mt-6">
          <Tier0DraftView narratives={sampleBundle(rows)} />
        </div>
        <div className="mt-10 flex justify-center">
          <StartEvaluationButton />
        </div>
        <WhatGuideBuoyIs className="mt-9" />
      </MarketingSection>
    </MarketingPage>
  )
}
