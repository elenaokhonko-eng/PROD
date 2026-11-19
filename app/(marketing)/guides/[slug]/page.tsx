import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { MarketingPage, MarketingSection } from '@/components/harbor/marketing-page'
import { StartEvaluationButton } from '@/components/harbor/start-evaluation-button'
import { WhatGuideBuoyIs } from '@/components/harbor/what-guidebuoy-is'
import { JsonLd } from '@/components/seo/json-ld'
import { Button } from '@/components/ui/button'
import { paidStagesState } from '@/lib/billing/paid-stages'
import { type GuideBlock, type GuideInline, formatReviewedOn, guideAction, loadPublishedGuides } from '@/lib/guides/guides'
import { pageAlternates, pagePreview } from '@/lib/seo/indexing'
import { articleJsonLd, breadcrumbJsonLd } from '@/lib/seo/structured-data'

// Brief W1 §O: one published guide. Only published guides are built; any other address is not found.
export const dynamicParams = false

export function generateStaticParams() {
  return loadPublishedGuides().map((guide) => ({ slug: guide.slug }))
}

const findGuide = (slug: string) => loadPublishedGuides().find((guide) => guide.slug === slug)

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const guide = findGuide(params.slug)
  if (!guide) return {}
  const title = `${guide.title} · GuideBuoy`
  return {
    title: { absolute: title },
    description: guide.description,
    alternates: pageAlternates(`/guides/${guide.slug}`),
    ...pagePreview(`/guides/${guide.slug}`, title, guide.description),
  }
}

function Inlines({ inlines }: { inlines: GuideInline[] }) {
  return (
    <>
      {inlines.map((inline, i) =>
        inline.href ? (
          <a
            key={i}
            href={inline.href}
            className="font-medium underline underline-offset-4"
            {...(inline.href.startsWith('https://') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {inline.text}
          </a>
        ) : inline.bold ? (
          <strong key={i}>{inline.text}</strong>
        ) : (
          <span key={i}>{inline.text}</span>
        ),
      )}
    </>
  )
}

function Block({ block }: { block: GuideBlock }): ReactNode {
  if (block.kind === 'heading') {
    return block.level === 2 ? (
      <h2 className="pt-4 text-2xl font-semibold text-harbor-deep">{block.text}</h2>
    ) : (
      <h3 className="pt-2 text-xl font-semibold">{block.text}</h3>
    )
  }
  if (block.kind === 'list') {
    const items = block.items.map((item, j) => (
      <li key={j}>
        <Inlines inlines={item} />
      </li>
    ))
    return block.ordered ? <ol className="list-decimal space-y-1 pl-6">{items}</ol> : <ul className="list-disc space-y-1 pl-6">{items}</ul>
  }
  return (
    <p>
      <Inlines inlines={block.inlines} />
    </p>
  )
}

export default function GuidePage({ params }: { params: { slug: string } }) {
  const guide = findGuide(params.slug)
  if (!guide) notFound()
  const action = guideAction(guide.stage, paidStagesState().enabled)
  return (
    <MarketingPage title={guide.title}>
      <JsonLd data={articleJsonLd(guide)} />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'Home', path: '/' },
          { name: 'Guides', path: '/guides' },
          { name: guide.title, path: `/guides/${guide.slug}` },
        ])}
      />
      <MarketingSection className="mx-auto flex max-w-3xl flex-col gap-5 leading-7">
        <p className="text-lg leading-8 font-medium">{guide.answer}</p>
        {guide.blocks.map((block, i) => (
          <Block key={i} block={block} />
        ))}
        <section aria-labelledby="sources-title" className="pt-4">
          <h2 id="sources-title" className="text-xl font-semibold text-harbor-deep">Sources</h2>
          <ul className="mt-3 list-disc space-y-1 pl-6">
            {guide.sources.map((source) => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                  {source.label}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
        <p className="text-sm text-muted-foreground">
          Last reviewed <time dateTime={guide.reviewedOn}>{formatReviewedOn(guide.reviewedOn)}</time> by {guide.reviewedBy}
        </p>
        <div className="flex justify-center pt-4">
          {action.kind === 'pack' ? (
            <Button asChild size="lg" className="text-base font-semibold">
              <Link href={action.href}>{action.label}</Link>
            </Button>
          ) : (
            <StartEvaluationButton />
          )}
        </div>
        <WhatGuideBuoyIs className="mt-4" />
      </MarketingSection>
    </MarketingPage>
  )
}
