'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const faqGroups = [
  {
    title: 'Getting started',
    items: [
      ['Who can use GuideBuoy?', 'GuideBuoy helps people organise information about scams, fraud, unauthorised transactions and disputes. The complaint-path check is informational; the relevant organisation decides what it accepts.'],
      ['Do I need an account before telling my story?', 'No. Your draft stays in this browser until you sign in. It does not become a case until sign-in and case setup succeed.'],
      ['Is Singpass available?', 'Singpass sign-in is not currently available. Use an available method shown by the sign-in provider.'],
      ['What if forms are hard for me?', 'You can type or record your story. A recording is sent for transcription after you stop it, and the transcript remains editable.'],
    ],
  },
  {
    title: 'Your report',
    items: [
      ['What does GuideBuoy produce?', 'GuideBuoy organises the information available in your case into a draft or report. Missing and uncertain details may remain visible.'],
      ['Are outputs reviewed by a person?', 'Generated automatically by GuideBuoy AI. It has not been reviewed by a person.'],
      ['Can I correct an output?', 'Review generated information carefully. Add or correct case information through the actions available in your workspace.'],
      ['Does a pathway signal decide my case?', 'No. GuideBuoy helps organise information. It does not decide your case or provide legal advice.'],
    ],
  },
  {
    title: 'Products and pricing',
    items: [
      ['Is it free to start?', 'Start organising for free. Tell your story, add supporting material, and receive a draft when your case is ready.'],
      ['What does the full report cost?', 'Full report — S$18. Review the price and what is included before continuing to checkout.'],
      ['What does the FIDReC case pack cost?', 'FIDReC case pack — S$188. It is available after a completed report, where offered. Review the scope before checkout.'],
      ['Is human consultation included?', 'Human consultation is not currently available.'],
    ],
  },
  {
    title: 'Privacy and control',
    items: [
      ['Who can see my case?', 'Access requires a signed-in account and is limited by the case permissions enforced by the service. Use care when choosing what to upload or share.'],
      ['Can I export my information?', 'A signed-in user can request the available account export from Settings.'],
      ['Can I delete my information?', 'Request data deletion. A request must be reviewed, and lawful security, accounting and legal-retention exceptions may apply. The control remains unavailable until a durable request and receipt service is present.'],
    ],
  },
] as const

type Category = 'All' | (typeof faqGroups)[number]['title']

export function FAQExplorer() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<Category>('All')
  const normalisedQuery = query.trim().toLocaleLowerCase()

  const visibleGroups = useMemo(
    () => faqGroups
      .filter((group) => category === 'All' || group.title === category)
      .map((group) => ({
        ...group,
        items: group.items.filter(([question, answer]) =>
          !normalisedQuery || `${question} ${answer}`.toLocaleLowerCase().includes(normalisedQuery),
        ),
      }))
      .filter((group) => group.items.length > 0),
    [category, normalisedQuery],
  )

  const resultCount = visibleGroups.reduce((total, group) => total + group.items.length, 0)

  return (
    <div>
      <div className="rounded-card border bg-card p-4 sm:p-6">
        <label htmlFor="faq-search" className="font-semibold">Search questions</label>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" aria-hidden="true" />
          <Input
            id="faq-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-h-11 pl-10"
            placeholder="For example: Singpass or report"
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="FAQ category">
          {(['All', ...faqGroups.map((group) => group.title)] as Category[]).map((item) => (
            <Button
              key={item}
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={category === item}
              onClick={() => setCategory(item)}
              className={cn(category === item && 'border-primary bg-harbor-teal-tint')}
            >
              {item}
            </Button>
          ))}
        </div>
        <p className="sr-only" role="status" aria-live="polite">{resultCount} questions shown.</p>
      </div>

      {visibleGroups.length ? (
        <div className="mt-8 space-y-8">
          {visibleGroups.map((group, groupIndex) => (
            <section key={group.title} aria-labelledby={`faq-group-${groupIndex}`}>
              <h2 id={`faq-group-${groupIndex}`} className="mb-4 text-2xl font-semibold text-harbor-deep">{group.title}</h2>
              <Accordion type="single" collapsible className="space-y-3">
                {group.items.map(([question, answer], itemIndex) => (
                  <AccordionItem key={question} value={`${groupIndex}-${itemIndex}`} className="rounded-card border bg-card px-4">
                    <AccordionTrigger className="min-h-14 text-left text-base">{question}</AccordionTrigger>
                    <AccordionContent className="pr-4 leading-7 text-muted-foreground sm:pr-8">{answer}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>
          ))}
        </div>
      ) : (
        <section className="mt-8 rounded-card border border-dashed bg-card p-6 text-center" role="status">
          <h2 className="text-xl font-semibold">No matching questions</h2>
          <p className="mt-2 text-muted-foreground">Try another word or show all categories.</p>
          <Button type="button" variant="outline" className="mt-4" onClick={() => { setQuery(''); setCategory('All') }}>
            Clear search
          </Button>
        </section>
      )}
    </div>
  )
}
