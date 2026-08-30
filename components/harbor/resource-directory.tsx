'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { VerifiedExternalLinkCard } from '@/components/harbor/verified-external-link-card'
import { cn } from '@/lib/utils'
import { HARBOR_RESOURCES } from '@/lib/harbor/resources'

type Resource = (typeof HARBOR_RESOURCES)[number]
type Category = 'All' | Resource['category']

export function ResourceDirectory() {
  const [resources, setResources] = useState<readonly Resource[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<Category>('All')
  const normalisedQuery = query.trim().toLocaleLowerCase()

  const loadResources = async () => {
    setStatus('loading')
    try {
      const response = await fetch('/api/resources', { headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error('Resources could not be loaded.')
      const data: unknown = await response.json()
      if (!data || typeof data !== 'object' || !Array.isArray((data as { resources?: unknown }).resources)) {
        throw new Error('Resources response was invalid.')
      }
      setResources((data as { resources: readonly Resource[] }).resources)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }

  useEffect(() => { void loadResources() }, [])

  const visibleResources = useMemo(
    () => resources.filter((resource) => {
      const inCategory = category === 'All' || resource.category === category
      const matchesSearch = !normalisedQuery || `${resource.title} ${resource.description} ${resource.source}`.toLocaleLowerCase().includes(normalisedQuery)
      return inCategory && matchesSearch
    }),
    [category, normalisedQuery, resources],
  )

  const categories = ['All', ...new Set(resources.map((resource) => resource.category))] as Category[]

  if (status === 'loading') return <p role="status" className="rounded-card border bg-card p-6">Loading official resources...</p>
  if (status === 'error') {
    return (
      <section className="rounded-card border border-dashed bg-card p-6 text-center" role="alert">
        <h2 className="text-xl font-semibold">Resources are temporarily unavailable</h2>
        <p className="mt-2 text-muted-foreground">Please try again in a moment.</p>
        <Button type="button" variant="outline" className="mt-4" onClick={() => { void loadResources() }}>Try again</Button>
      </section>
    )
  }

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
