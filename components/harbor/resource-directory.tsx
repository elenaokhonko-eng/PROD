import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ResourceDirectory() {
  return (
    <section
      className="rounded-card border border-dashed bg-card p-6 text-center"
      role="status"
      aria-labelledby="resources-unavailable-title"
    >
      <AlertTriangle className="mx-auto size-7 text-muted-foreground" aria-hidden="true" />
      <h2 id="resources-unavailable-title" className="mt-3 text-xl font-semibold">
        Official resources are not currently available
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-muted-foreground">
        This directory will return when its verified provider-backed data contract is ready. Check the relevant
        organisation&apos;s official website directly in the meantime.
      </p>
      <Button type="button" variant="outline" disabled className="mt-4">
        Resource search is not currently available.
      </Button>
    </section>
  )
}
