'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { FAQ_GROUPS, faqAnswer } from '@/lib/harbor/faq'
import { cn } from '@/lib/utils'

const ALL = 'All'

export function FAQExplorer({ packsLive = false }: { packsLive?: boolean }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(ALL)
  const normalisedQuery = query.trim().toLocaleLowerCase()

  const visibleGroups = useMemo(
    () => FAQ_GROUPS
      .filter((group) => category === ALL || group.title === category)
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          !normalisedQuery || `${item.question} ${faqAnswer(item, packsLive)}`.toLocaleLowerCase().includes(normalisedQuery),
        ),
      }))
      .filter((group) => group.items.length > 0),
    [category, normalisedQuery, packsLive],
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
            placeholder="For example: refund or FIDReC"
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="FAQ category">
          {[ALL, ...FAQ_GROUPS.map((group) => group.title)].map((item) => (
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
              {/* Brief W1 §J: any number of answers can be open at once. */}
              <Accordion type="multiple" className="space-y-3">
                {group.items.map((item) => (
                  <AccordionItem key={item.question} value={item.question} className="rounded-card border bg-card px-4">
                    <AccordionTrigger className="min-h-14 text-left text-base">{item.question}</AccordionTrigger>
                    {/* forceMount keeps every answer in the server HTML (brief W1 §J), so the page's markdown copy has them too. */}
                    <AccordionContent forceMount className="pr-4 text-base leading-7 text-foreground sm:pr-8">
                      {faqAnswer(item, packsLive)}
                      {item.link ? (
                        <>
                          {' '}
                          <Link href={item.link.href} className="font-medium underline">{item.link.label}</Link>
                        </>
                      ) : null}
                    </AccordionContent>
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
          <Button type="button" variant="outline" className="mt-4" onClick={() => { setQuery(''); setCategory(ALL) }}>
            Clear search
          </Button>
        </section>
      )}
    </div>
  )
}
