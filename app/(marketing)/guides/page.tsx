import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MarketingPage, MarketingSection } from '@/components/harbor/marketing-page'
import { WhatGuideBuoyIs } from '@/components/harbor/what-guidebuoy-is'
import { JsonLd } from '@/components/seo/json-ld'
import { GUIDE_STAGES, STAGE_TITLES, loadPublishedGuides } from '@/lib/guides/guides'
import { NOINDEX, pageAlternates, pagePreview } from '@/lib/seo/indexing'
import { breadcrumbJsonLd } from '@/lib/seo/structured-data'

// Brief W1 §O: the guides index, grouped by stage. It exists only once a guide is published; until then the page is
// not found and stays out of the sitemap, the menu and llms.txt.

const TITLE = 'Guides for scam and bank dispute cases in Singapore · GuideBuoy'
const DESCRIPTION = 'Step-by-step guides for each stage of a scam or bank dispute, reviewed and linked to official sources.'

export function generateMetadata(): Metadata {
  if (loadPublishedGuides().length === 0) return { robots: NOINDEX }
  return {
    title: { absolute: TITLE },
    description: DESCRIPTION,
    alternates: pageAlternates('/guides'),
    ...pagePreview('/guides', TITLE, DESCRIPTION),
  }
}

export default function GuidesPage() {
  const guides = loadPublishedGuides()
  if (guides.length === 0) notFound()
  return (
    <MarketingPage title="Guides">
      <JsonLd data={breadcrumbJsonLd([{ name: 'Home', path: '/' }, { name: 'Guides', path: '/guides' }])} />
      <MarketingSection className="max-w-4xl">
        {GUIDE_STAGES.map((stage) => {
          const inStage = guides.filter((guide) => guide.stage === stage)
          if (inStage.length === 0) return null
          return (
            <section key={stage} aria-labelledby={`stage-${stage}`} className="mt-10 first:mt-0">
              <h2 id={`stage-${stage}`} className="text-2xl font-semibold text-harbor-deep">{STAGE_TITLES[stage]}</h2>
              <ul className="mt-4 space-y-3">
                {inStage.map((guide) => (
                  <li key={guide.slug} className="rounded-card border bg-card p-5">
                    <Link href={`/guides/${guide.slug}`} className="text-lg font-semibold text-primary underline underline-offset-4">
                      {guide.title}
                    </Link>
                    <p className="mt-2 leading-7 text-muted-foreground">{guide.description}</p>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
        <WhatGuideBuoyIs className="mt-12" />
      </MarketingSection>
    </MarketingPage>
  )
}
