'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { VerifiedExternalLinkCard } from '@/components/harbor/verified-external-link-card'
import { cn } from '@/lib/utils'

const resources = [
  {
    category: 'Right now',
    title: 'Protect accounts and check suspicious contacts',
    description: 'Find current scam checks, reporting guidance and safety information on ScamShield’s website.',
    href: 'https://www.scamshield.gov.sg/',
    source: 'ScamShield',
  },
  {
    category: 'Right now',
    title: 'Find Police e-services',
    description: 'Use the Singapore Police Force website to find the relevant online reporting service.',
    href: 'https://www.police.gov.sg/E-Services',
    source: 'Singapore Police Force',
  },
  {
    category: 'Disputes',
    title: 'E-Payments User Protection Guidelines',
    description: 'Read the current guidance for unauthorised or mistaken transactions on the MAS website.',
    href: 'https://www.mas.gov.sg/regulation/guidelines/e-payments-user-protection-guidelines',
    source: 'Monetary Authority of Singapore',
  },
  {
    category: 'Disputes',
    title: 'Financial dispute resolution',
    description: 'Check current eligibility, process and filing information directly with FIDReC.',
    href: 'https://www.fidrec.com.sg/',
    source: 'FIDReC',
  },
  {
    category: 'Data and online safety',
    title: 'Personal Data Protection Act overview',
    description: 'Read the legislation overview and related guidance on the PDPC website.',
    href: 'https://www.pdpc.gov.sg/about/the-legislation/pdpa-overview',
    source: 'Personal Data Protection Commission',
  },
  {
    category: 'Data and online safety',
    title: 'Scam calls and messages',
    description: 'Find current telecommunications and online-safety information on the IMDA website.',
    href: 'https://www.imda.gov.sg/how-we-can-help/scam-and-spam-prevention',
    source: 'Infocomm Media Development Authority',
  },
] as const

type Category = 'All' | (typeof resources)[number]['category']

export function ResourceDirectory() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<Category>('All')
  const normalisedQuery = query.trim().toLocaleLowerCase()

  const visibleResources = useMemo(
    () => resources.filter((resource) => {
      const inCategory = category === 'All' || resource.category === category
      const matchesSearch = !normalisedQuery || `${resource.title} ${resource.description} ${resource.source}`.toLocaleLowerCase().includes(normalisedQuery)
      return inCategory && matchesSearch
    }),
    [category, normalisedQuery],
  )

  const categories = ['All', ...new Set(resources.map((resource) => resource.category))] as Category[]

  return (
    <div>
      <div className="rounded-card border bg-card p-4 sm:p-6">
        <label htmlFor="resource-search" className="font-semibold">Search external resources</label>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" aria-hidden="true" />
          <Input
            id="resource-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-h-11 pl-10"
            placeholder="Search by topic or organisation"
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Resource category">
          {categories.map((item) => (
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
        <p className="sr-only" role="status" aria-live="polite">{visibleResources.length} resources shown.</p>
      </div>

      {visibleResources.length ? (
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {visibleResources.map((resource) => <VerifiedExternalLinkCard key={resource.title} {...resource} />)}
        </div>
      ) : (
        <section className="mt-8 rounded-card border border-dashed bg-card p-6 text-center" role="status">
          <h2 className="text-xl font-semibold">No matching resources</h2>
          <p className="mt-2 text-muted-foreground">Try another search or show all categories.</p>
          <Button type="button" variant="outline" className="mt-4" onClick={() => { setQuery(''); setCategory('All') }}>
            Clear search
          </Button>
        </section>
      )}
    </div>
  )
}
