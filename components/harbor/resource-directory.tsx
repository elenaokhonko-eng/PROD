'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface OfficialResource {
  id: string
  name: string
  summary: string
  category: string
  url: string
}

type DirectoryState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; resources: OfficialResource[] }

function parseResources(value: unknown): OfficialResource[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { resources?: unknown }).resources)) {
    throw new Error('Invalid resource response')
  }

  return (value as { resources: unknown[] }).resources.map((resource) => {
    if (!resource || typeof resource !== 'object') throw new Error('Invalid resource')
    const candidate = resource as Partial<OfficialResource>
    if (
      !candidate.id ||
      !candidate.name ||
      !candidate.summary ||
      !candidate.category ||
      !candidate.url
    ) {
      throw new Error('Invalid resource')
    }
    const url = new URL(candidate.url)
    if (url.protocol !== 'https:') throw new Error('Invalid resource URL')
    return candidate as OfficialResource
  })
}

export function ResourceDirectory() {
  const [state, setState] = useState<DirectoryState>({ status: 'loading' })
  const [requestVersion, setRequestVersion] = useState(0)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })

    void fetch('/api/resources', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Resource directory unavailable')
        return parseResources(await response.json())
      })
      .then((resources) => setState({ status: 'ready', resources }))
      .catch((error: unknown) => {
        if ((error as Error).name !== 'AbortError') setState({ status: 'error' })
      })

    return () => controller.abort()
  }, [requestVersion])

  const filteredResources = useMemo(() => {
    if (state.status !== 'ready') return []
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return state.resources
    return state.resources.filter((resource) =>
      [resource.name, resource.summary, resource.category].some((value) =>
        value.toLowerCase().includes(normalizedQuery),
      ),
    )
  }, [query, state])

  if (state.status === 'loading') {
    return (
      <section className="rounded-card border bg-card p-6 text-center" role="status" aria-live="polite">
        <Loader2 className="mx-auto size-7 animate-spin text-muted-foreground" aria-hidden="true" />
        <h2 className="mt-3 text-xl font-semibold">Loading official resources…</h2>
      </section>
    )
  }

  if (state.status === 'error') {
    return (
      <section className="rounded-card border border-dashed bg-card p-6 text-center" role="alert">
        <AlertTriangle className="mx-auto size-7 text-muted-foreground" aria-hidden="true" />
        <h2 className="mt-3 text-xl font-semibold">Official resources are not currently available</h2>
        <p className="mx-auto mt-2 max-w-xl text-muted-foreground">
          The verified provider-backed directory could not be loaded. No resource information is being substituted
          locally.
        </p>
        <Button type="button" variant="outline" className="mt-4" onClick={() => setRequestVersion((value) => value + 1)}>
          Try again
        </Button>
      </section>
    )
  }

  return (
    <section className="rounded-card border bg-card p-5 sm:p-6" aria-labelledby="resources-directory-title">
      <h2 id="resources-directory-title" className="text-xl font-semibold">Official resource directory</h2>
      <label className="mt-4 block text-sm font-medium" htmlFor="resource-filter">Filter verified resources</label>
      <div className="relative mt-2">
        <Search className="pointer-events-none absolute left-3 top-3 size-5 text-muted-foreground" aria-hidden="true" />
        <Input
          id="resource-filter"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="pl-10"
          placeholder="Search by name, category or topic"
        />
      </div>

      {state.resources.length === 0 ? (
        <p className="mt-5 rounded-xl bg-muted p-4 text-muted-foreground">No official resources are available.</p>
      ) : filteredResources.length === 0 ? (
        <p className="mt-5 rounded-xl bg-muted p-4 text-muted-foreground">No resources match this filter.</p>
      ) : (
        <ul className="mt-5 grid gap-4 md:grid-cols-2">
          {filteredResources.map((resource) => (
            <li key={resource.id} className="rounded-xl border p-4">
              <p className="text-sm font-medium text-muted-foreground">{resource.category}</p>
              <h3 className="mt-1 font-semibold">{resource.name}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{resource.summary}</p>
              <Button asChild variant="outline" size="sm" className="mt-4">
                <a href={resource.url} target="_blank" rel="noreferrer">Visit official website</a>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
